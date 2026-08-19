import { readFile } from 'node:fs/promises';
import { writeFileAtomic } from '../platform/atomic-write.js';
import { log } from '../core/logger.js';

export interface SessionRecord {
  sessionId: string | undefined;
  cwd: string;
  messages: ChatMessage[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface SessionTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface SessionMetrics extends SessionTokenUsage {
  contextUsedTokens?: number;
  contextWindow?: number;
}

export interface SessionContextIdentity {
  sessionId: string | undefined;
  model: string;
}

interface StoredSessionMetrics extends SessionTokenUsage {
  contexts?: StoredContextSnapshot[];
}

interface StoredContextSnapshot {
  sessionId: string;
  model: string;
  usedTokens: number;
  contextWindow: number;
}

const MAX_CONTEXT_SNAPSHOTS_PER_SCOPE = 32;

export interface RecordExchangeOptions {
  /** Max live messages kept for the scope (overflow is archived, then trimmed). */
  retention?: number;
  /** Called with the messages that fall outside the retention window. */
  onArchive?: (overflow: ChatMessage[]) => void | Promise<void>;
}

interface SessionData {
  chats: Record<string, SessionRecord>;
  metrics: Record<string, StoredSessionMetrics>;
}

export class SessionStore {
  private data: SessionData = { chats: {}, metrics: {} };
  /** Live session-id → scope index (used by the agent question-card router). */
  private sessionScopes = new Map<string, string>();
  private saving: Promise<void> = Promise.resolve();
  private pendingArchive: Promise<void> = Promise.resolve();
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw) as Partial<SessionData>;
      this.data = {
        chats: Object.fromEntries(
          Object.entries(parsed.chats ?? {}).map(([scope, record]) => [
            scope,
            {
              sessionId: record.sessionId,
              cwd: record.cwd,
              messages: record.messages ?? [],
            },
          ]),
        ),
        metrics: Object.fromEntries(
          Object.entries(parsed.metrics ?? {}).map(([scope, metrics]) => [
            scope,
            normalizeMetrics(metrics),
          ]),
        ),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }

  getRaw(scopeId: string): SessionRecord | undefined {
    return this.data.chats[scopeId];
  }

  set(scopeId: string, sessionId: string | undefined, cwd: string): void {
    const existing = this.data.chats[scopeId];
    this.data.chats[scopeId] = {
      sessionId: sessionId ?? existing?.sessionId,
      cwd,
      messages: existing?.messages ?? [],
    };
    if (sessionId) this.sessionScopes.set(sessionId, scopeId);
    this.schedulePersist();
  }

  /**
   * Reverse lookup used by the bridge question-card router: map a live dsh
   * session id back to its bridge scope. Falls back to a scan of the loaded
   * records (e.g. after a fresh load before any live run registered).
   */
  scopeForSession(sessionId: string): string | undefined {
    const direct = this.sessionScopes.get(sessionId);
    if (direct !== undefined) return direct;
    for (const [scope, record] of Object.entries(this.data.chats)) {
      if (record.sessionId === sessionId) return scope;
    }
    return undefined;
  }

  historyFor(scopeId: string, cwd: string): ChatMessage[] {
    const record = this.data.chats[scopeId];
    return record && record.cwd === cwd ? record.messages : [];
  }

  recordExchange(
    scopeId: string,
    cwd: string,
    userMessages: string[],
    assistantMessage: string | undefined,
    options: RecordExchangeOptions = {},
  ): void {
    const existing = this.data.chats[scopeId];
    const next: ChatMessage[] = [...(existing?.messages ?? [])];

    for (const content of userMessages) {
      if (content.trim()) next.push({ role: 'user', content });
    }

    if (assistantMessage?.trim()) {
      next.push({ role: 'assistant', content: assistantMessage });
    }

    const retention = options.retention ?? 40;
    let kept: ChatMessage[] = next;
    if (retention > 0 && next.length > retention) {
      const overflow = next.slice(0, next.length - retention);
      kept = next.slice(-retention);
      this.pendingArchive = this.pendingArchive
        .then(async () => {
          await options.onArchive?.(overflow);
        })
        .catch((error: unknown) => {
          log.fail('session', error, { scope: scopeId, step: 'archive-overflow' });
        });
    }

    this.data.chats[scopeId] = {
      sessionId: existing?.sessionId,
      cwd,
      messages: kept,
    };
    this.schedulePersist();
  }

  /** Full live transcript for a scope (subject to the current retention window). */
  fullHistoryFor(scopeId: string, cwd: string): ChatMessage[] {
    const record = this.data.chats[scopeId];
    return record && record.cwd === cwd ? [...record.messages] : [];
  }

  /** Add one model-call usage sample to the current scope session totals. */
  recordUsage(scopeId: string, usage: SessionTokenUsage): void {
    const current = this.data.metrics[scopeId] ?? {};
    const next: SessionMetrics = { ...current };
    addMetric(next, 'inputTokens', usage.inputTokens);
    addMetric(next, 'outputTokens', usage.outputTokens);
    addMetric(next, 'cacheReadTokens', usage.cacheReadTokens);
    addMetric(next, 'cacheWriteTokens', usage.cacheWriteTokens);
    this.data.metrics[scopeId] = next;
    this.schedulePersist();
  }

  /** Replace the latest protocol-reported context snapshot for the scope. */
  recordContextUsage(
    scopeId: string,
    context: { usedTokens: number; contextWindow: number; sessionId: string; model: string },
  ): void {
    if (!validMetric(context.usedTokens) || !validContextWindow(context.contextWindow)) return;
    const current = this.data.metrics[scopeId] ?? {};
    const nextContext: StoredContextSnapshot = {
      sessionId: context.sessionId,
      model: context.model,
      usedTokens: context.usedTokens,
      contextWindow: context.contextWindow,
    };
    this.data.metrics[scopeId] = {
      ...current,
      contexts: [
        ...(current.contexts ?? []).filter(
          (candidate) =>
            candidate.sessionId !== context.sessionId || candidate.model !== context.model,
        ),
        nextContext,
      ].slice(-MAX_CONTEXT_SNAPSHOTS_PER_SCOPE),
    };
    this.schedulePersist();
  }

  metricsFor(scopeId: string, current?: SessionContextIdentity): SessionMetrics | undefined {
    const stored = this.data.metrics[scopeId];
    if (!stored) return undefined;
    const { contexts, ...tokens } = stored;
    const metrics: SessionMetrics = { ...tokens };
    const context = current?.sessionId === undefined
      ? undefined
      : [...(contexts ?? [])].reverse().find(
          (candidate) =>
            candidate.sessionId === current.sessionId && candidate.model === current.model,
        );
    if (context) {
      metrics.contextUsedTokens = context.usedTokens;
      metrics.contextWindow = context.contextWindow;
    }
    return metrics;
  }

  clear(scopeId: string): boolean {
    if (!(scopeId in this.data.chats) && !(scopeId in this.data.metrics)) return false;
    delete this.data.chats[scopeId];
    delete this.data.metrics[scopeId];
    this.schedulePersist();
    return true;
  }

  fork(scopeId: string, newScopeId: string, cwd: string): boolean {
    const source = this.data.chats[scopeId];
    if (!source) return false;
    this.data.chats[newScopeId] = {
      sessionId: undefined,
      cwd,
      messages: [...source.messages],
    };
    this.schedulePersist();
    return true;
  }

  resumeFor(scopeId: string, cwd: string): string | undefined {
    const record = this.data.chats[scopeId];
    return record && record.cwd === cwd ? record.sessionId : undefined;
  }

  /**
   * Drop the native dsh session binding for a scope. The transcript is kept so
   * the next run can start a fresh session and replay history from the store.
   */
  clearSession(scopeId: string): void {
    const existing = this.data.chats[scopeId];
    if (!existing) return;
    this.data.chats[scopeId] = { ...existing, sessionId: undefined };
    this.schedulePersist();
  }

  async flush(): Promise<void> {
    await this.pendingArchive;
    await this.saving;
  }

  private schedulePersist(): void {
    const snapshot = this.snapshot();
    this.saving = this.saving
      .then(async () => {
        await writeFileAtomic(this.path, `${JSON.stringify(snapshot, null, 2)}\n`, {
          mode: 0o600,
        });
      })
      .catch((error: unknown) => {
        log.fail('session', error, { step: 'persist' });
      });
  }

  private snapshot(): SessionData {
    return {
      chats: Object.fromEntries(
        Object.entries(this.data.chats).map(([key, record]) => [
          key,
          {
            ...record,
            messages: [...record.messages],
          },
        ]),
      ),
      metrics: Object.fromEntries(
        Object.entries(this.data.metrics).map(([scope, metrics]) => [scope, { ...metrics }]),
      ),
    };
  }
}

function validMetric(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validContextWindow(value: unknown): value is number {
  return validMetric(value) && value > 0;
}

function addMetric(
  metrics: SessionTokenUsage,
  key: keyof SessionTokenUsage,
  value: number | undefined,
): void {
  if (!validMetric(value)) return;
  metrics[key] = (metrics[key] ?? 0) + value;
}

function normalizeMetrics(value: unknown): StoredSessionMetrics {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const metrics: StoredSessionMetrics = {};
  for (const key of [
    'inputTokens',
    'outputTokens',
    'cacheReadTokens',
    'cacheWriteTokens',
  ] as const) {
    if (validMetric(raw[key])) {
      metrics[key] = raw[key] as number;
    }
  }
  if (Array.isArray(raw.contexts)) {
    metrics.contexts = raw.contexts
      .map(normalizeContextSnapshot)
      .filter((context): context is StoredContextSnapshot => context !== undefined)
      .slice(-MAX_CONTEXT_SNAPSHOTS_PER_SCOPE);
  }
  return metrics;
}

function normalizeContextSnapshot(value: unknown): StoredContextSnapshot | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.sessionId !== 'string' || candidate.sessionId.length === 0 ||
    typeof candidate.model !== 'string' || candidate.model.length === 0 ||
    !validMetric(candidate.usedTokens) ||
    !validContextWindow(candidate.contextWindow)
  ) return undefined;
  return {
    sessionId: candidate.sessionId,
    model: candidate.model,
    usedTokens: candidate.usedTokens,
    contextWindow: candidate.contextWindow,
  };
}
