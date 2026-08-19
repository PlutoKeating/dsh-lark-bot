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

interface WorkspaceSessionState {
  record: SessionRecord;
  metrics: StoredSessionMetrics;
}

interface SessionDataV2 {
  schema: 2;
  workspaces: Record<string, Record<string, WorkspaceSessionState>>;
}

interface LegacySessionData {
  chats?: Record<string, SessionRecord>;
  metrics?: Record<string, StoredSessionMetrics>;
}

const MAX_CONTEXT_SNAPSHOTS_PER_WORKSPACE = 32;

export interface RecordExchangeOptions {
  /** Max live messages kept for the workspace session (overflow is archived, then trimmed). */
  retention?: number;
  /** Called with the messages that fall outside the retention window. */
  onArchive?: (overflow: ChatMessage[]) => void | Promise<void>;
}

/** Persistent sessions keyed by bridge scope and canonical workspace cwd. */
export class SessionStore {
  private data: SessionDataV2 = { schema: 2, workspaces: {} };
  private legacyScopes = new Set<string>();
  /** Live native session-id → scope/workspace index used by callback routers. */
  private sessionScopes = new Map<string, { scopeId: string; cwd: string }>();
  private saving: Promise<void> = Promise.resolve();
  private pendingArchive: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.path, 'utf8')) as SessionDataV2 & LegacySessionData;
      const legacy = raw.schema !== 2 || !isObject(raw.workspaces);
      this.data = legacy ? migrateLegacy(raw) : normalizeV2(raw.workspaces);
      this.legacyScopes = legacy ? new Set(Object.keys(this.data.workspaces)) : new Set();
      this.rebuildSessionIndex();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }

  getRaw(scopeId: string, cwd: string): SessionRecord | undefined {
    return this.data.workspaces[scopeId]?.[cwd]?.record;
  }

  set(scopeId: string, sessionId: string | undefined, cwd: string): void {
    const state = this.ensureState(scopeId, cwd);
    state.record = {
      sessionId: sessionId ?? state.record.sessionId,
      cwd,
      messages: state.record.messages,
    };
    if (sessionId) this.sessionScopes.set(sessionId, { scopeId, cwd });
    this.schedulePersist();
  }

  scopeForSession(sessionId: string): string | undefined {
    const direct = this.sessionScopes.get(sessionId);
    if (direct) return direct.scopeId;
    for (const [scopeId, workspaces] of Object.entries(this.data.workspaces)) {
      for (const state of Object.values(workspaces)) {
        if (state.record.sessionId === sessionId) return scopeId;
      }
    }
    return undefined;
  }

  /** Canonical user-selected workspace that owns a native dsh session. */
  workspaceForSession(sessionId: string): string | undefined {
    const direct = this.sessionScopes.get(sessionId);
    if (direct) return direct.cwd;
    for (const workspaces of Object.values(this.data.workspaces)) {
      for (const [cwd, state] of Object.entries(workspaces)) {
        if (state.record.sessionId === sessionId) return cwd;
      }
    }
    return undefined;
  }

  legacyScopeIds(): string[] {
    return [...this.legacyScopes];
  }

  /** Schema-1 execution cwd retained until the scope is adopted. */
  legacyWorkspaceCwd(scopeId: string): string | undefined {
    if (!this.legacyScopes.has(scopeId)) return undefined;
    const entries = Object.keys(this.data.workspaces[scopeId] ?? {});
    return entries.length === 1 ? entries[0] : undefined;
  }

  /**
   * Attach a schema-1 scope record to the workspace selected at upgrade time.
   * Old files stored only the execution cwd (often a generated worktree), so
   * WorkspaceStore is the authoritative source for the user's project cwd.
   */
  adoptLegacyWorkspace(scopeId: string, workspaceCwd: string): boolean {
    if (!this.legacyScopes.delete(scopeId)) return false;
    const workspaces = this.data.workspaces[scopeId];
    if (!workspaces || workspaces[workspaceCwd]) return false;
    const entries = Object.entries(workspaces);
    if (entries.length !== 1) return false;
    const [oldCwd, state] = entries[0]!;
    delete workspaces[oldCwd];
    state.record = { ...state.record, cwd: workspaceCwd };
    workspaces[workspaceCwd] = state;
    this.rebuildSessionIndex();
    this.schedulePersist();
    return true;
  }

  historyFor(scopeId: string, cwd: string): ChatMessage[] {
    return [...(this.getRaw(scopeId, cwd)?.messages ?? [])];
  }

  recordExchange(
    scopeId: string,
    cwd: string,
    userMessages: string[],
    assistantMessage: string | undefined,
    options: RecordExchangeOptions = {},
  ): void {
    const state = this.ensureState(scopeId, cwd);
    const next = [...state.record.messages];
    for (const content of userMessages) {
      if (content.trim()) next.push({ role: 'user', content });
    }
    if (assistantMessage?.trim()) next.push({ role: 'assistant', content: assistantMessage });

    const retention = options.retention ?? 40;
    let kept = next;
    if (retention > 0 && next.length > retention) {
      const overflow = next.slice(0, next.length - retention);
      kept = next.slice(-retention);
      this.pendingArchive = this.pendingArchive
        .then(async () => options.onArchive?.(overflow))
        .catch((error: unknown) => {
          log.fail('session', error, { scope: scopeId, cwd, step: 'archive-overflow' });
        });
    }
    state.record = { ...state.record, cwd, messages: kept };
    this.schedulePersist();
  }

  fullHistoryFor(scopeId: string, cwd: string): ChatMessage[] {
    return this.historyFor(scopeId, cwd);
  }

  recordUsage(scopeId: string, cwd: string, usage: SessionTokenUsage): void {
    const state = this.ensureState(scopeId, cwd);
    const next: StoredSessionMetrics = { ...state.metrics };
    addMetric(next, 'inputTokens', usage.inputTokens);
    addMetric(next, 'outputTokens', usage.outputTokens);
    addMetric(next, 'cacheReadTokens', usage.cacheReadTokens);
    addMetric(next, 'cacheWriteTokens', usage.cacheWriteTokens);
    state.metrics = next;
    this.schedulePersist();
  }

  recordContextUsage(
    scopeId: string,
    cwd: string,
    context: { usedTokens: number; contextWindow: number; sessionId: string; model: string },
  ): void {
    if (!validMetric(context.usedTokens) || !validContextWindow(context.contextWindow)) return;
    const state = this.ensureState(scopeId, cwd);
    const nextContext: StoredContextSnapshot = {
      sessionId: context.sessionId,
      model: context.model,
      usedTokens: context.usedTokens,
      contextWindow: context.contextWindow,
    };
    state.metrics = {
      ...state.metrics,
      contexts: [
        ...(state.metrics.contexts ?? []).filter(
          (candidate) =>
            candidate.sessionId !== context.sessionId || candidate.model !== context.model,
        ),
        nextContext,
      ].slice(-MAX_CONTEXT_SNAPSHOTS_PER_WORKSPACE),
    };
    this.schedulePersist();
  }

  metricsFor(
    scopeId: string,
    cwd: string,
    current?: SessionContextIdentity,
  ): SessionMetrics | undefined {
    const stored = this.data.workspaces[scopeId]?.[cwd]?.metrics;
    if (!stored || Object.keys(stored).length === 0) return undefined;
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

  /** Clear only the selected workspace session; sibling workspaces survive. */
  clear(scopeId: string, cwd: string): boolean {
    const workspaces = this.data.workspaces[scopeId];
    const state = workspaces?.[cwd];
    if (!workspaces || !state) return false;
    for (const [sessionId, owner] of this.sessionScopes) {
      if (owner.scopeId === scopeId && owner.cwd === cwd) this.sessionScopes.delete(sessionId);
    }
    delete workspaces[cwd];
    if (Object.keys(workspaces).length === 0) delete this.data.workspaces[scopeId];
    this.schedulePersist();
    return true;
  }

  fork(scopeId: string, newScopeId: string, cwd: string): boolean {
    const source = this.data.workspaces[scopeId]?.[cwd];
    if (!source) return false;
    const target = this.ensureState(newScopeId, cwd);
    target.record = { sessionId: undefined, cwd, messages: [...source.record.messages] };
    target.metrics = {};
    this.schedulePersist();
    return true;
  }

  resumeFor(scopeId: string, cwd: string): string | undefined {
    return this.getRaw(scopeId, cwd)?.sessionId;
  }

  /** Drop only this workspace's native binding while preserving its transcript and metrics. */
  clearSession(scopeId: string, cwd: string): void {
    const state = this.data.workspaces[scopeId]?.[cwd];
    if (!state) return;
    if (state.record.sessionId) this.sessionScopes.delete(state.record.sessionId);
    state.record = { ...state.record, sessionId: undefined };
    this.schedulePersist();
  }

  async flush(): Promise<void> {
    await this.pendingArchive;
    await this.saving;
  }

  private ensureState(scopeId: string, cwd: string): WorkspaceSessionState {
    const workspaces = this.data.workspaces[scopeId] ?? {};
    this.data.workspaces[scopeId] = workspaces;
    const state = workspaces[cwd] ?? {
      record: { sessionId: undefined, cwd, messages: [] },
      metrics: {},
    };
    workspaces[cwd] = state;
    return state;
  }

  private rebuildSessionIndex(): void {
    this.sessionScopes.clear();
    for (const [scopeId, workspaces] of Object.entries(this.data.workspaces)) {
      for (const [cwd, state] of Object.entries(workspaces)) {
        if (state.record.sessionId) {
          this.sessionScopes.set(state.record.sessionId, { scopeId, cwd });
        }
      }
    }
  }

  private schedulePersist(): void {
    const snapshot = snapshotData(this.data);
    this.saving = this.saving
      .then(async () => {
        await writeFileAtomic(this.path, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
      })
      .catch((error: unknown) => {
        log.fail('session', error, { step: 'persist' });
      });
  }
}

function migrateLegacy(raw: LegacySessionData): SessionDataV2 {
  const workspaces: SessionDataV2['workspaces'] = {};
  for (const [scopeId, record] of Object.entries(raw.chats ?? {})) {
    if (!record || typeof record.cwd !== 'string') continue;
    workspaces[scopeId] = {
      [record.cwd]: {
        record: normalizeRecord(record, record.cwd),
        metrics: normalizeMetrics(raw.metrics?.[scopeId]),
      },
    };
  }
  return { schema: 2, workspaces };
}

function normalizeV2(value: unknown): SessionDataV2 {
  const workspaces: SessionDataV2['workspaces'] = {};
  if (!isObject(value)) return { schema: 2, workspaces };
  for (const [scopeId, rawWorkspaces] of Object.entries(value)) {
    if (!isObject(rawWorkspaces)) continue;
    for (const [cwd, rawState] of Object.entries(rawWorkspaces)) {
      if (!isObject(rawState)) continue;
      const record = normalizeRecord(rawState.record, cwd);
      const metrics = normalizeMetrics(rawState.metrics);
      (workspaces[scopeId] ??= {})[cwd] = { record, metrics };
    }
  }
  return { schema: 2, workspaces };
}

function normalizeRecord(value: unknown, cwd: string): SessionRecord {
  const raw = isObject(value) ? value : {};
  const messages = Array.isArray(raw.messages)
    ? raw.messages.filter(isChatMessage).map((message) => ({ ...message }))
    : [];
  return {
    sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : undefined,
    cwd,
    messages,
  };
}

function snapshotData(data: SessionDataV2): SessionDataV2 {
  return {
    schema: 2,
    workspaces: Object.fromEntries(
      Object.entries(data.workspaces).map(([scopeId, workspaces]) => [
        scopeId,
        Object.fromEntries(Object.entries(workspaces).map(([cwd, state]) => [
          cwd,
          {
            record: { ...state.record, messages: state.record.messages.map((message) => ({ ...message })) },
            metrics: {
              ...state.metrics,
              ...(state.metrics.contexts
                ? { contexts: state.metrics.contexts.map((context) => ({ ...context })) }
                : {}),
            },
          },
        ])),
      ]),
    ),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isChatMessage(value: unknown): value is ChatMessage {
  return isObject(value) && (value.role === 'user' || value.role === 'assistant') &&
    typeof value.content === 'string';
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
  if (!isObject(value)) return {};
  const metrics: StoredSessionMetrics = {};
  for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const) {
    if (validMetric(value[key])) metrics[key] = value[key] as number;
  }
  if (Array.isArray(value.contexts)) {
    metrics.contexts = value.contexts
      .map(normalizeContextSnapshot)
      .filter((context): context is StoredContextSnapshot => context !== undefined)
      .slice(-MAX_CONTEXT_SNAPSHOTS_PER_WORKSPACE);
  }
  return metrics;
}

function normalizeContextSnapshot(value: unknown): StoredContextSnapshot | undefined {
  if (!isObject(value)) return undefined;
  if (
    typeof value.sessionId !== 'string' || value.sessionId.length === 0 ||
    typeof value.model !== 'string' || value.model.length === 0 ||
    !validMetric(value.usedTokens) || !validContextWindow(value.contextWindow)
  ) return undefined;
  return {
    sessionId: value.sessionId,
    model: value.model,
    usedTokens: value.usedTokens,
    contextWindow: value.contextWindow,
  };
}
