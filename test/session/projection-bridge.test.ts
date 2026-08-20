import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ScopeDirectory } from '../../src/bridge/scope-directory.js';
import { SessionProjectionBridge } from '../../src/session/projection-bridge.js';
import type {
  DshHistoryPage,
  DshSessionEvent,
  DshSessionSummary,
  SessionProjectionSource,
} from '../../src/session/projection-protocol.js';
import { SessionProjectionStore } from '../../src/session/projection-store.js';

class FakeSocket extends EventTarget {
  close(): void { this.dispatchEvent(new Event('close')); }
  emit(sessionId: string, event: DshSessionEvent): void {
    this.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ payload: { type: 'session/event', sessionId, event } }),
    }));
  }
}

class FakeSource implements SessionProjectionSource {
  sessions: DshSessionSummary[] = [];
  events = new Map<string, DshSessionEvent[]>();
  sockets: FakeSocket[] = [];
  historyFailures = 0;

  async listSessions(): Promise<DshSessionSummary[]> { return structuredClone(this.sessions); }
  async history(sessionId: string, options: { beforeSeq?: number } = {}): Promise<DshHistoryPage> {
    if (this.historyFailures > 0) {
      this.historyFailures -= 1;
      throw new Error('token revoked');
    }
    const all = this.events.get(sessionId) ?? [];
    const selected = all.filter((event) => options.beforeSeq === undefined || event.seq < options.beforeSeq);
    return { events: structuredClone(selected), hasMore: false };
  }
  async prompt(_sessionId: string, _text: string, rpcId: string = 'rpc'): Promise<{ rpcId: string }> { return { rpcId }; }
  async openMux(): Promise<WebSocket> {
    const socket = new FakeSocket();
    this.sockets.push(socket);
    return socket as unknown as WebSocket;
  }
}

function user(seq: number, id: string, text: string, rpcId?: string): DshSessionEvent {
  return {
    type: 'user/message', seq, time: seq,
    data: { id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user', ...(rpcId ? { rpcId } : {}) } },
  };
}

function chunk(seq: number, text: string, turn = 1): DshSessionEvent {
  return { type: 'assistant/chunk', seq, time: seq, data: { turn, step: 1, chunk: { type: 'text-delta', text } } };
}

function assistant(seq: number, id: string, text: string, turn = 1): DshSessionEvent {
  return {
    type: 'assistant/message', seq, time: seq, sourceEventSeqs: [seq - 2, seq - 1],
    data: { turn, step: 1, message: { id, role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model' } } },
  };
}

describe('SessionProjectionBridge', () => {
  it('filters selectors, bounds transcript, suppresses Feishu echo and finalizes one streamed card', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-projection-bridge-'));
    const store = new SessionProjectionStore(join(root, 'projection.json'));
    const scopes = new ScopeDirectory(join(root, 'scopes.json'));
    await Promise.all([store.load(), scopes.load()]);
    const source = new FakeSource();
    source.sessions = [
      { sessionId: 's1', updatedAt: 20, running: false, blank: false, cwd: '/repo', title: 'Main' },
      { sessionId: 'sub', updatedAt: 30, running: false, blank: false, cwd: '/repo', origin: 'subagent' },
      { sessionId: 'fork', updatedAt: 10, running: false, blank: false, cwd: '/repo', parentSessionId: 's0' },
      { sessionId: 'other', updatedAt: 40, running: false, blank: false, cwd: '/other' },
    ];
    source.events.set('s1', [user(0, 'u0', 'old question'), assistant(1, 'a1', 'old answer')]);
    const sendCard = vi.fn(async (_chatId: string, _card: object) => `card-${sendCard.mock.calls.length}`);
    const updateCard = vi.fn(async (_messageId: string, _card: object) => undefined);
    const bridge = new SessionProjectionBridge({
      source, store,
      channel: { sendMarkdown: vi.fn(), sendCard, updateCard },
      limits: { backfillMessages: 20, backfillBytes: 64 * 1024, historyPageMessages: 100, streamUpdateMs: 400, reconnectMs: 1 },
    });

    expect((await bridge.eligibleSessions('/repo')).map((item) => item.sessionId)).toEqual(['s1', 'fork']);
    const prepared = await bridge.prepare('s1', '/repo');
    expect(prepared.messages.map((item) => item.content)).toEqual(['old question', 'old answer']);
    await bridge.bindConfirmed({ scope: 'chat-a:thread-a', workspaceCwd: '/repo', chatId: 'chat-a', threadId: 'thread-a', prepared });
    expect(sendCard).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(sendCard.mock.calls[0]?.[1])).toContain('old question');

    await store.recordCorrelation('chat-a:thread-a', '/repo', 's1', {
      rpcId: 'rpc-feishu', feishuMessageId: 'original-feishu', createdAt: Date.now(),
    });
    await bridge.start();
    const socket = source.sockets[0]!;
    const live: DshSessionEvent[] = [
      { type: 'turn/start', seq: 2, time: 2, data: { turn: 1 } },
      user(3, 'u3', 'from Feishu', 'rpc-feishu'),
      chunk(4, 'bridge answer', 1), assistant(5, 'a5', 'bridge answer', 1),
      { type: 'turn/end', seq: 6, time: 6, data: { turn: 1, reason: { kind: 'completed' } } },
      { type: 'turn/start', seq: 7, time: 7, data: { turn: 2 } },
      user(8, 'u8', 'from another client'),
      chunk(9, 'hello ', 2), chunk(10, 'world', 2), assistant(11, 'a11', 'hello world', 2),
      { type: 'turn/end', seq: 12, time: 12, data: { turn: 2, reason: { kind: 'completed' } } },
    ];
    source.events.set('s1', [...source.events.get('s1')!, ...live]);
    for (const event of live) socket.emit('s1', event);

    await vi.waitFor(() => expect(store.ownerOf('s1')?.lastProjectedSeq).toBe(12));
    expect(sendCard).toHaveBeenCalledTimes(3); // transcript + mirrored user + one assistant card
    expect(JSON.stringify(sendCard.mock.calls[1]?.[1])).toContain('from another client');
    expect(JSON.stringify(sendCard.mock.calls[1]?.[1])).not.toContain('from Feishu');
    expect(updateCard).toHaveBeenCalledWith('card-3', expect.any(Object));
    expect(JSON.stringify(updateCard.mock.calls.at(-1)?.[1])).toContain('hello world');
    expect(store.ownerOf('s1')?.recentMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({ dshMessageId: 'u3', feishuMessageId: 'original-feishu', source: 'feishu' }),
      expect.objectContaining({ dshMessageId: 'a11', feishuMessageId: 'card-3', finalized: true }),
    ]));
    await bridge.close();
  });

  it('catches up a committed event after mux reconnect without replaying prior seqs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-projection-reconnect-'));
    const store = new SessionProjectionStore(join(root, 'projection.json'));
    const scopes = new ScopeDirectory(join(root, 'scopes.json'));
    await Promise.all([store.load(), scopes.load()]);
    const source = new FakeSource();
    source.sessions = [{ sessionId: 's1', updatedAt: 1, running: false, blank: false, cwd: '/repo' }];
    source.events.set('s1', []);
    const sendCard = vi.fn(async (_chatId: string, _card: object) => `card-${sendCard.mock.calls.length}`);
    const bridge = new SessionProjectionBridge({
      source, store,
      channel: { sendMarkdown: vi.fn(), sendCard, updateCard: vi.fn() },
      limits: { backfillMessages: 20, backfillBytes: 10_000, historyPageMessages: 100, streamUpdateMs: 400, reconnectMs: 1 },
    });
    await bridge.bindConfirmed({
      scope: 'chat-a', workspaceCwd: '/repo', chatId: 'chat-a', prepared: await bridge.prepare('s1', '/repo'),
    });
    await bridge.start();
    source.events.set('s1', [user(0, 'u0', 'missed while disconnected')]);
    source.sockets[0]!.close();
    await vi.waitFor(() => expect(source.sockets.length).toBeGreaterThan(1));
    await vi.waitFor(() => expect(store.ownerOf('s1')?.lastProjectedSeq).toBe(0));
    expect(sendCard).toHaveBeenCalledOnce();
    source.sockets[1]!.emit('s1', user(0, 'u0', 'missed while disconnected'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(sendCard).toHaveBeenCalledOnce();
    await bridge.close();
  });

  it('keeps the bridge alive and retries after history authorization failures', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-projection-auth-'));
    const store = new SessionProjectionStore(join(root, 'projection.json'));
    const scopes = new ScopeDirectory(join(root, 'scopes.json'));
    await Promise.all([store.load(), scopes.load()]);
    const source = new FakeSource();
    source.sessions = [{ sessionId: 's1', updatedAt: 1, running: false, blank: false, cwd: '/repo' }];
    source.events.set('s1', []);
    const sendCard = vi.fn(async (_chatId: string, _card: object) => 'card');
    const bridge = new SessionProjectionBridge({
      source, store,
      channel: { sendMarkdown: vi.fn(), sendCard, updateCard: vi.fn() },
      limits: { backfillMessages: 20, backfillBytes: 10_000, historyPageMessages: 100, streamUpdateMs: 400, reconnectMs: 1 },
    });
    await bridge.bindConfirmed({
      scope: 'chat-a', workspaceCwd: '/repo', chatId: 'chat-a', prepared: await bridge.prepare('s1', '/repo'),
    });
    source.events.set('s1', [user(0, 'u0', 'recovered')]);
    source.historyFailures = 2;
    await bridge.start();
    await vi.waitFor(() => expect(store.ownerOf('s1')?.lastProjectedSeq).toBe(0));
    expect(sendCard).toHaveBeenCalledOnce();
    expect(source.sockets.length).toBeGreaterThanOrEqual(2);
    await bridge.close();
  });

  it('falls back to a new bot-owned card when the streaming card can no longer be updated', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-projection-fallback-'));
    const store = new SessionProjectionStore(join(root, 'projection.json'));
    const scopes = new ScopeDirectory(join(root, 'scopes.json'));
    await Promise.all([store.load(), scopes.load()]);
    const source = new FakeSource();
    source.sessions = [{ sessionId: 's1', updatedAt: 1, running: false, blank: false, cwd: '/repo' }];
    source.events.set('s1', []);
    const sendCard = vi.fn(async (_chatId: string, _card: object) => `card-${sendCard.mock.calls.length}`);
    const updateCard = vi.fn(async () => { throw new Error('card expired'); });
    const bridge = new SessionProjectionBridge({
      source, store,
      channel: { sendMarkdown: vi.fn(), sendCard, updateCard },
      limits: { backfillMessages: 20, backfillBytes: 10_000, historyPageMessages: 100, streamUpdateMs: 400, reconnectMs: 1 },
    });
    await bridge.bindConfirmed({
      scope: 'chat-a', workspaceCwd: '/repo', chatId: 'chat-a', prepared: await bridge.prepare('s1', '/repo'),
    });
    await bridge.start();
    const events: DshSessionEvent[] = [chunk(0, 'partial'), assistant(1, 'a1', 'final')];
    source.events.set('s1', events);
    for (const event of events) source.sockets[0]!.emit('s1', event);
    await vi.waitFor(() => expect(store.ownerOf('s1')?.lastProjectedSeq).toBe(1));
    expect(updateCard).toHaveBeenCalledWith('card-1', expect.any(Object));
    expect(sendCard).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(sendCard.mock.calls[1]?.[1])).toContain('后续增量');
    expect(store.ownerOf('s1')?.recentMessages).toContainEqual(
      expect.objectContaining({ dshMessageId: 'a1', feishuMessageId: 'card-2', finalized: true }),
    );
    await bridge.close();
  });

  it('folds history surface replacements and hides synthetic plugin context', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-projection-surface-'));
    const store = new SessionProjectionStore(join(root, 'projection.json'));
    const source = new FakeSource();
    await store.load();
    source.sessions = [{ sessionId: 's1', updatedAt: 1, running: false, blank: false, cwd: '/repo' }];
    source.events.set('s1', [
      { ...user(0, 'u0', 'superseded human prompt'), surfaceOp: 'append' },
      { ...assistant(1, 'a1', 'kept answer'), surfaceOp: 'append' },
      {
        type: 'user/message', seq: 2, time: 2,
        surfaceOp: { op: 'replace', start: 0, end: 0 }, sourceEventSeqs: [0],
        data: { id: 'summary', role: 'user', content: [{ type: 'text', text: 'synthetic summary' }], source: { kind: 'plugin', plugin: 'compaction' } },
      },
    ]);
    const bridge = new SessionProjectionBridge({
      source, store, channel: { sendMarkdown: vi.fn() },
      limits: { backfillMessages: 20, backfillBytes: 10_000, historyPageMessages: 100, streamUpdateMs: 400, reconnectMs: 1 },
    });
    expect((await bridge.prepare('s1', '/repo')).messages.map((message) => message.content))
      .toEqual(['kept answer']);
  });
});
