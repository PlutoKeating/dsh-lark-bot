import type { CommandChannel } from '../commands/index.js';
import { bilingualMarkdown } from '../card/i18n.js';
import {
  renderProjectedMessageCard,
  renderTranscriptCard,
  type TranscriptMessage,
} from '../card/session-projection-card.js';
import { log } from '../core/logger.js';
import {
  decodeMuxEvent,
  isRecord,
  textContent,
  type DshSessionEvent,
  type DshSessionSummary,
  type SessionProjectionSource,
} from './projection-protocol.js';
import type {
  ProjectionSource,
  SessionProjectionBinding,
  SessionProjectionStore,
} from './projection-store.js';

export interface SessionProjectionLimits {
  backfillMessages: number;
  backfillBytes: number;
  historyPageMessages: number;
  streamUpdateMs: number;
  reconnectMs: number;
}

export interface PreparedSessionBinding {
  session: DshSessionSummary;
  messages: TranscriptMessage[];
  backfillCount: number;
  truncated: boolean;
  snapshotSeq: number;
}

interface StreamBuffer {
  key: string;
  content: string;
  firstSeq: number;
  lastSeq: number;
  messageId: string | undefined;
  lastSentAt: number;
}

const KNOWN_NON_PROJECTED_EVENTS = new Set([
  'turn/start', 'turn/end', 'tool/call', 'tool/result', 'session/title',
  'session/model', 'session/end-seed', 'todo/write', 'llm/retry',
]);

/** Ordered event-log → Feishu materializer for explicitly bound sessions only. */
export class SessionProjectionBridge {
  private readonly queues = new Map<string, Promise<void>>();
  private readonly streams = new Map<string, StreamBuffer>();
  private readonly activeTurns = new Map<string, string>();
  private readonly feishuTurns = new Set<string>();
  private socket: WebSocket | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private closed = true;

  constructor(private readonly deps: {
    source: SessionProjectionSource;
    store: SessionProjectionStore;
    channel: CommandChannel;
    limits: SessionProjectionLimits;
  }) {}

  async start(): Promise<void> {
    if (!this.closed) return;
    this.closed = false;
    for (const binding of this.deps.store.list()) {
      try {
        await this.serial(binding.sessionId, () => this.catchUp(binding));
      } catch (error) {
        log.fail('session-projection', error, { step: 'startup-catch-up', sessionId: binding.sessionId });
      }
    }
    await this.connect();
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    try { this.socket?.close(); } catch { /* best effort */ }
    this.socket = undefined;
    await Promise.allSettled([...this.queues.values()]);
    await this.deps.store.flush();
  }

  async eligibleSessions(workspaceCwd: string): Promise<DshSessionSummary[]> {
    return (await this.deps.source.listSessions())
      .filter((session) => session.cwd === workspaceCwd && session.origin !== 'subagent')
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async prepare(sessionId: string, workspaceCwd: string): Promise<PreparedSessionBinding> {
    const session = (await this.eligibleSessions(workspaceCwd)).find((item) => item.sessionId === sessionId);
    if (!session) throw new Error('session is not selectable in the current workspace');
    const page = await this.deps.source.history(sessionId, {
      maxMessages: this.deps.limits.backfillMessages + 1,
    });
    const human = surfaceTranscript(page.events);
    const bounded = boundTranscript(human, this.deps.limits.backfillMessages, this.deps.limits.backfillBytes);
    return {
      session,
      messages: bounded.messages,
      backfillCount: bounded.messages.length,
      truncated: page.hasMore || bounded.truncated,
      snapshotSeq: page.events.reduce((max, event) => Math.max(max, event.seq), -1),
    };
  }

  async bindConfirmed(input: {
    scope: string;
    workspaceCwd: string;
    chatId: string;
    threadId?: string;
    prepared: PreparedSessionBinding;
  }): Promise<void> {
    if (input.prepared.messages.length > 0) {
      if (!this.deps.channel.sendCard) throw new Error('channel cannot deliver the confirmed transcript card');
      await this.deps.channel.sendCard(
        input.chatId,
        renderTranscriptCard({
          title: input.prepared.session.title ?? input.prepared.session.sessionId,
          sessionId: input.prepared.session.sessionId,
          messages: input.prepared.messages,
          truncated: input.prepared.truncated,
        }),
        input.threadId ? { threadId: input.threadId } : undefined,
      );
    }
    await this.deps.store.bindExclusive({
      scope: input.scope,
      workspaceCwd: input.workspaceCwd,
      sessionId: input.prepared.session.sessionId,
      chatId: input.chatId,
      ...(input.threadId ? { threadId: input.threadId } : {}),
      initialSeq: input.prepared.snapshotSeq,
    });
    const binding = this.deps.store.get(input.scope, input.workspaceCwd);
    if (binding) await this.serial(binding.sessionId, () => this.catchUp(binding));
  }

  private async connect(): Promise<void> {
    if (this.closed) return;
    try {
      const socket = await this.deps.source.openMux();
      if (this.closed) {
        socket.close();
        return;
      }
      this.socket = socket;
      socket.addEventListener('message', (frame: { data: unknown }) => {
        const decoded = decodeMuxEvent(String(frame.data));
        if (!decoded || !this.deps.store.ownerOf(decoded.sessionId)) return;
        void this.serial(decoded.sessionId, async () => {
          const binding = this.deps.store.ownerOf(decoded.sessionId);
          if (!binding) return;
          if (decoded.event.seq > binding.lastProjectedSeq + 1) await this.catchUp(binding);
          const current = this.deps.store.ownerOf(decoded.sessionId);
          if (current && decoded.event.seq > current.lastProjectedSeq) {
            await this.project(current, decoded.event);
          }
        }).catch((error) => {
          log.fail('session-projection', error, {
            step: 'live-event', sessionId: decoded.sessionId, seq: decoded.event.seq,
          });
          try { this.socket?.close(); } catch { /* reconnect below */ }
        });
      });
      socket.addEventListener('close', () => {
        if (this.socket === socket) this.socket = undefined;
        this.scheduleReconnect();
      }, { once: true });
      socket.addEventListener('error', () => {
        log.warn('session-projection', 'mux-error', {});
      });
      for (const binding of this.deps.store.list()) {
        await this.serial(binding.sessionId, () => this.catchUp(binding));
      }
      log.info('session-projection', 'mux-connected', { bindings: this.deps.store.list().length });
    } catch (error) {
      log.fail('session-projection', error, { step: 'connect' });
      try { this.socket?.close(); } catch { /* best effort */ }
      this.socket = undefined;
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, this.deps.limits.reconnectMs);
    this.reconnectTimer.unref?.();
  }

  private async catchUp(initial: SessionProjectionBinding): Promise<void> {
    let binding = this.deps.store.get(initial.scope, initial.workspaceCwd);
    if (!binding || binding.sessionId !== initial.sessionId) return;
    const gathered: DshSessionEvent[] = [];
    let beforeSeq: number | undefined;
    for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
      const page = await this.deps.source.history(binding.sessionId, {
        ...(beforeSeq === undefined ? {} : { beforeSeq }),
        maxMessages: this.deps.limits.historyPageMessages,
      });
      const candidates = page.events.filter((event) => event.seq > binding!.lastProjectedSeq);
      gathered.push(...candidates);
      const minimum = page.events.reduce((min, event) => Math.min(min, event.seq), Number.POSITIVE_INFINITY);
      if (!page.hasMore || !Number.isFinite(minimum) || minimum <= binding.lastProjectedSeq + 1) break;
      beforeSeq = minimum;
    }
    const ordered = [...new Map(gathered.map((event) => [event.seq, event])).values()]
      .sort((left, right) => left.seq - right.seq);
    for (const event of ordered) {
      binding = this.deps.store.get(initial.scope, initial.workspaceCwd);
      if (!binding || binding.sessionId !== initial.sessionId) return;
      if (event.seq <= binding.lastProjectedSeq) continue;
      if (event.seq !== binding.lastProjectedSeq + 1) {
        throw new Error(`session history gap: expected ${binding.lastProjectedSeq + 1}, got ${event.seq}`);
      }
      await this.project(binding, event);
    }
  }

  private async project(binding: SessionProjectionBinding, event: DshSessionEvent): Promise<void> {
    if (event.type === 'turn/start') {
      const data = isRecord(event.data) ? event.data : undefined;
      if (Number.isSafeInteger(data?.turn)) {
        this.activeTurns.set(binding.sessionId, String(data?.turn));
      }
    } else if (event.type === 'user/message') {
      await this.projectUser(binding, event);
    } else if (event.type === 'assistant/chunk') {
      await this.projectChunk(binding, event);
    } else if (event.type === 'assistant/message') {
      await this.projectAssistant(binding, event);
    } else if (!KNOWN_NON_PROJECTED_EVENTS.has(event.type) && event.ignorable !== true) {
      throw new Error(`unknown required DSH session event: ${event.type}`);
    }
    await this.deps.store.advance({
      scope: binding.scope,
      workspaceCwd: binding.workspaceCwd,
      sessionId: binding.sessionId,
      seq: event.seq,
    });
    if (event.type === 'turn/end') {
      const turn = this.activeTurns.get(binding.sessionId);
      if (turn) this.feishuTurns.delete(`${binding.sessionId}:${turn}`);
      this.activeTurns.delete(binding.sessionId);
    }
  }

  private async projectUser(binding: SessionProjectionBinding, event: DshSessionEvent): Promise<void> {
    if (!isRecord(event.data)) return;
    const sourceRecord = isRecord(event.data.source) ? event.data.source : undefined;
    if (sourceRecord?.kind !== 'user') return;
    const text = textContent(event.data.content).trim();
    if (!text || event.data.role !== 'user') return;
    const source = trustedSource(event.data.source);
    const rpcId = typeof sourceRecord?.rpcId === 'string' ? sourceRecord.rpcId : undefined;
    const correlation = rpcId
      ? this.deps.store.correlationFor(binding.scope, binding.workspaceCwd, rpcId)
      : undefined;
    const dshMessageId = typeof event.data.id === 'string' ? event.data.id : undefined;
    if (correlation) {
      const turn = this.activeTurns.get(binding.sessionId);
      if (turn) this.feishuTurns.add(`${binding.sessionId}:${turn}`);
      await this.deps.store.recordMessage(binding.scope, binding.workspaceCwd, binding.sessionId, {
        ...(dshMessageId ? { dshMessageId } : {}),
        firstSeq: event.seq,
        lastSeq: event.seq,
        role: 'user',
        source: 'feishu',
        feishuMessageId: correlation.feishuMessageId,
        renderMode: 'text',
        finalized: true,
      });
      return;
    }
    const messageId = await this.sendCard(binding, renderProjectedMessageCard({
      role: 'user', source, content: text,
    }));
    if (messageId) {
      await this.deps.store.recordMessage(binding.scope, binding.workspaceCwd, binding.sessionId, {
        ...(dshMessageId ? { dshMessageId } : {}),
        firstSeq: event.seq,
        lastSeq: event.seq,
        role: 'user', source, feishuMessageId: messageId, renderMode: 'card', finalized: true,
      });
    }
  }

  private async projectChunk(binding: SessionProjectionBinding, event: DshSessionEvent): Promise<void> {
    const data = isRecord(event.data) ? event.data : undefined;
    const chunk = isRecord(data?.chunk) ? data.chunk : undefined;
    if (chunk?.type !== 'text-delta' || typeof chunk.text !== 'string' || !chunk.text) return;
    const turn = Number.isSafeInteger(data?.turn) ? String(data?.turn) : 'unknown';
    const step = Number.isSafeInteger(data?.step) ? String(data?.step) : 'unknown';
    if (this.feishuTurns.has(`${binding.sessionId}:${turn}`)) return;
    const key = `${binding.sessionId}:${turn}:${step}`;
    const stream = this.streams.get(key) ?? {
      key: `stream:${turn}:${step}`,
      content: '', firstSeq: event.seq, lastSeq: event.seq, messageId: undefined,
      lastSentAt: 0,
    };
    stream.content += chunk.text;
    stream.lastSeq = event.seq;
    this.streams.set(key, stream);
    const remaining = this.deps.limits.streamUpdateMs - (Date.now() - stream.lastSentAt);
    if (stream.messageId && remaining > 0) await wait(remaining);
    await this.flushStream(binding, stream, false);
  }

  private async projectAssistant(binding: SessionProjectionBinding, event: DshSessionEvent): Promise<void> {
    const data = isRecord(event.data) ? event.data : undefined;
    const message = isRecord(data?.message) ? data.message : undefined;
    if (!isRecord(message?.source) || message.source.kind !== 'model') return;
    const text = textContent(message?.content).trim();
    if (!text || message?.role !== 'assistant') return;
    const turn = Number.isSafeInteger(data?.turn) ? String(data?.turn) : 'unknown';
    const step = Number.isSafeInteger(data?.step) ? String(data?.step) : 'unknown';
    if (this.feishuTurns.has(`${binding.sessionId}:${turn}`)) return;
    const key = `${binding.sessionId}:${turn}:${step}`;
    const stream = this.streams.get(key);
    if (stream) {
      stream.content = text;
      stream.lastSeq = event.seq;
      await this.flushStream(binding, stream, true, typeof message.id === 'string' ? message.id : undefined);
      this.streams.delete(key);
      return;
    }
    const dshMessageId = typeof message.id === 'string' ? message.id : undefined;
    const existing = binding.recentMessages.find((item) =>
      !item.finalized && item.role === 'assistant' && event.sourceEventSeqs?.some((seq) => seq >= item.firstSeq && seq <= item.lastSeq));
    let messageId = existing?.feishuMessageId;
    if (messageId && this.deps.channel.updateCard) {
      try {
        await this.deps.channel.updateCard(messageId, renderProjectedMessageCard({
          role: 'assistant', source: 'other-dsh-client', content: text,
        }));
      } catch {
        messageId = await this.sendCard(binding, renderProjectedMessageCard({
          role: 'assistant', source: 'other-dsh-client', content: text, fallback: true,
        }));
      }
    } else {
      messageId = await this.sendCard(binding, renderProjectedMessageCard({
        role: 'assistant', source: 'other-dsh-client', content: text,
      }));
    }
    if (messageId) await this.deps.store.recordMessage(binding.scope, binding.workspaceCwd, binding.sessionId, {
      ...(dshMessageId ? { dshMessageId } : {}),
      firstSeq: existing?.firstSeq ?? event.seq,
      lastSeq: event.seq,
      role: 'assistant', source: 'other-dsh-client', feishuMessageId: messageId,
      renderMode: 'card', finalized: true,
    });
  }

  private async flushStream(
    binding: SessionProjectionBinding,
    stream: StreamBuffer,
    finalized: boolean,
    finalMessageId?: string,
  ): Promise<void> {
    stream.lastSentAt = Date.now();
    const card = renderProjectedMessageCard({
      role: 'assistant', source: 'other-dsh-client', content: stream.content, streaming: !finalized,
    });
    if (stream.messageId && this.deps.channel.updateCard) {
      try {
        await this.deps.channel.updateCard(stream.messageId, card);
      } catch {
        stream.messageId = await this.sendCard(binding, renderProjectedMessageCard({
          role: 'assistant', source: 'other-dsh-client', content: stream.content,
          streaming: !finalized, fallback: true,
        }));
      }
    } else {
      stream.messageId = await this.sendCard(binding, card);
    }
    if (stream.messageId) {
      await this.deps.store.recordMessage(binding.scope, binding.workspaceCwd, binding.sessionId, {
        dshMessageId: finalMessageId ?? stream.key,
        firstSeq: stream.firstSeq,
        lastSeq: stream.lastSeq,
        role: 'assistant', source: 'other-dsh-client', feishuMessageId: stream.messageId,
        renderMode: 'card', finalized,
      });
    }
  }

  private async sendCard(binding: SessionProjectionBinding, card: object): Promise<string | undefined> {
    const options = binding.threadId ? { threadId: binding.threadId } : undefined;
    if (this.deps.channel.sendCard) return this.deps.channel.sendCard(binding.chatId, card, options);
    await this.deps.channel.sendMarkdown(
      binding.chatId,
      bilingualMarkdown('收到一条 DSH session 更新，但当前渠道不支持消息卡片。', 'A DSH session update arrived, but this channel does not support cards.'),
      options,
    );
    return undefined;
  }

  private serial(sessionId: string, task: () => Promise<void>): Promise<void> {
    const previous = this.queues.get(sessionId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    this.queues.set(sessionId, next);
    return next.finally(() => {
      if (this.queues.get(sessionId) === next) this.queues.delete(sessionId);
    });
  }
}

function transcriptMessage(event: DshSessionEvent): TranscriptMessage | undefined {
  if (event.type === 'user/message' && isRecord(event.data) && event.data.role === 'user') {
    if (!isRecord(event.data.source) || event.data.source.kind !== 'user') return undefined;
    const content = textContent(event.data.content).trim();
    return content ? { role: 'user', content, source: trustedSource(event.data.source) } : undefined;
  }
  if (event.type === 'assistant/message' && isRecord(event.data)) {
    const message = isRecord(event.data.message) ? event.data.message : undefined;
    if (!isRecord(message?.source) || message.source.kind !== 'model') return undefined;
    const content = textContent(message?.content).trim();
    return content ? { role: 'assistant', content, source: 'other-dsh-client' } : undefined;
  }
  return undefined;
}

function surfaceTranscript(events: DshSessionEvent[]): TranscriptMessage[] {
  const rows: Array<{ seq: number; message: TranscriptMessage }> = [];
  for (const event of [...events].sort((left, right) => left.seq - right.seq)) {
    if (event.surfaceOp && typeof event.surfaceOp === 'object' && event.surfaceOp.op === 'replace') {
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        const seq = rows[index]!.seq;
        if (seq >= event.surfaceOp.start && seq <= event.surfaceOp.end) rows.splice(index, 1);
      }
    }
    const message = transcriptMessage(event);
    if (message) rows.push({ seq: event.seq, message });
  }
  return rows.map((row) => row.message);
}

function trustedSource(value: unknown): ProjectionSource {
  if (!isRecord(value)) return 'other-dsh-client';
  // These labels are used only when the host supplied explicit provenance.
  if (value.client === 'web') return 'web';
  if (value.client === 'tui') return 'tui';
  return 'other-dsh-client';
}

function boundTranscript(
  messages: TranscriptMessage[],
  maxMessages: number,
  maxBytes: number,
): { messages: TranscriptMessage[]; truncated: boolean } {
  const selected: TranscriptMessage[] = [];
  let bytes = 0;
  for (const message of messages.slice(-maxMessages).reverse()) {
    const size = Buffer.byteLength(message.content, 'utf8');
    if (bytes + size > maxBytes) break;
    selected.push(message);
    bytes += size;
  }
  selected.reverse();
  return { messages: selected, truncated: selected.length < messages.length };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}
