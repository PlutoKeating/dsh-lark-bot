import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { log } from '../core/logger.js';
import { writeFileAtomic } from '../platform/atomic-write.js';

export type ProjectionRole = 'user' | 'assistant';
export type ProjectionSource = 'feishu' | 'web' | 'tui' | 'other-dsh-client';
export type ProjectionRenderMode = 'text' | 'post' | 'card';

export interface ProjectedMessage {
  dshMessageId?: string;
  firstSeq: number;
  lastSeq: number;
  role: ProjectionRole;
  source: ProjectionSource;
  feishuMessageId: string;
  renderMode: ProjectionRenderMode;
  finalized: boolean;
  /** Persisted only to resume an in-flight assistant card after restart. */
  content?: string;
}

export interface ActiveTurnState {
  turn: string;
  feishuOrigin: boolean;
}

export interface PromptCorrelation {
  rpcId: string;
  feishuMessageId: string;
  createdAt: number;
}

export interface SessionProjectionBinding {
  scope: string;
  workspaceCwd: string;
  sessionId: string;
  chatId: string;
  threadId?: string;
  lastProjectedSeq: number;
  /** Binding is exclusive, but live delivery waits until this snapshot is acknowledged. */
  pendingHistoryThroughSeq?: number;
  activeTurn?: ActiveTurnState;
  recentMessages: ProjectedMessage[];
  promptCorrelations: PromptCorrelation[];
  boundAt: string;
  generationId: string;
}

interface ProjectionData {
  schemaVersion: 1;
  bindings: Record<string, SessionProjectionBinding>;
}

export interface ExclusiveBindingResult {
  binding: SessionProjectionBinding;
  replaced?: SessionProjectionBinding;
  displaced?: SessionProjectionBinding;
}

const MAX_RECENT_MESSAGES = 64;
const MAX_PROMPT_CORRELATIONS = 64;
const PROMPT_CORRELATION_TTL_MS = 24 * 60 * 60_000;

/**
 * Durable materialized projection state. DSH owns the transcript; this store
 * contains only routing, cursor and remote-message reconciliation metadata.
 */
export class SessionProjectionStore {
  private data: ProjectionData = { schemaVersion: 1, bindings: {} };
  private saving: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Partial<ProjectionData>;
      const bindings = Object.fromEntries(
        Object.values(parsed.bindings ?? {}).flatMap((value) => {
          const normalized = normalizeBinding(value);
          return normalized ? [[keyFor(normalized.scope, normalized.workspaceCwd), normalized]] : [];
        }),
      );
      this.data = { schemaVersion: 1, bindings };
      this.assertExclusive();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.data = { schemaVersion: 1, bindings: {} };
        return;
      }
      throw error;
    }
  }

  get(scope: string, workspaceCwd: string): SessionProjectionBinding | undefined {
    return cloneBinding(this.data.bindings[keyFor(scope, workspaceCwd)]);
  }

  ownerOf(sessionId: string): SessionProjectionBinding | undefined {
    return cloneBinding(Object.values(this.data.bindings).find((item) => item.sessionId === sessionId));
  }

  list(): SessionProjectionBinding[] {
    return Object.values(this.data.bindings).map((item) => cloneBinding(item)!);
  }

  async bindExclusive(input: {
    scope: string;
    workspaceCwd: string;
    sessionId: string;
    chatId: string;
    threadId?: string;
    initialSeq: number;
    pendingInitialHistory?: boolean;
    /** Only an already-authorized administrator may displace another scope. */
    allowCrossScopeMigration?: boolean;
    /** Owner disclosed by the confirmation card; any change makes it stale. */
    expectedOwner?: { scope: string; workspaceCwd: string };
  }): Promise<ExclusiveBindingResult> {
    return this.commit(async () => {
      const targetKey = keyFor(input.scope, input.workspaceCwd);
      const replaced = this.data.bindings[targetKey];
      const displacedEntry = Object.entries(this.data.bindings).find(
        ([key, binding]) => key !== targetKey && binding.sessionId === input.sessionId,
      );
      const currentOwner = displacedEntry?.[1]
        ?? (replaced?.sessionId === input.sessionId ? replaced : undefined);
      const expectedMatches = input.expectedOwner
        ? currentOwner?.scope === input.expectedOwner.scope &&
          currentOwner.workspaceCwd === input.expectedOwner.workspaceCwd
        : currentOwner === undefined;
      if (!expectedMatches) {
        throw new Error('session binding owner changed after disclosure; open a new confirmation');
      }
      if (displacedEntry && input.allowCrossScopeMigration !== true) {
        throw new Error('cross-scope exclusive session migration is not authorized');
      }
      if (displacedEntry) delete this.data.bindings[displacedEntry[0]];
      const binding: SessionProjectionBinding = {
        scope: input.scope,
        workspaceCwd: input.workspaceCwd,
        sessionId: input.sessionId,
        chatId: input.chatId,
        ...(input.threadId ? { threadId: input.threadId } : {}),
        lastProjectedSeq: input.pendingInitialHistory ? -1 : input.initialSeq,
        ...(input.pendingInitialHistory ? { pendingHistoryThroughSeq: input.initialSeq } : {}),
        ...(currentOwner?.activeTurn ? { activeTurn: structuredClone(currentOwner.activeTurn) } : {}),
        recentMessages: currentOwner?.scope === input.scope && currentOwner.workspaceCwd === input.workspaceCwd
          ? structuredClone(currentOwner.recentMessages)
          : [],
        promptCorrelations: structuredClone(currentOwner?.promptCorrelations ?? []),
        boundAt: new Date().toISOString(),
        generationId: randomUUID(),
      };
      this.data.bindings[targetKey] = binding;
      return {
        binding: cloneBinding(binding)!,
        ...(replaced ? { replaced: cloneBinding(replaced)! } : {}),
        ...(displacedEntry ? { displaced: cloneBinding(displacedEntry[1])! } : {}),
      };
    }, { step: 'bind', scope: input.scope, sessionId: input.sessionId });
  }

  async advance(input: {
    scope: string;
    workspaceCwd: string;
    sessionId: string;
    seq: number;
    message?: ProjectedMessage;
    activeTurn?: ActiveTurnState | null;
  }): Promise<boolean> {
    return this.commit(async () => {
      const binding = this.data.bindings[keyFor(input.scope, input.workspaceCwd)];
      if (!binding || binding.sessionId !== input.sessionId || input.seq <= binding.lastProjectedSeq) {
        return false;
      }
      binding.lastProjectedSeq = input.seq;
      if (input.activeTurn === null) delete binding.activeTurn;
      else if (input.activeTurn) binding.activeTurn = structuredClone(input.activeTurn);
      if (input.message) {
        binding.recentMessages = [
          ...binding.recentMessages.filter((item) =>
            input.message?.dshMessageId
              ? item.dshMessageId !== input.message.dshMessageId
              : item.feishuMessageId !== input.message?.feishuMessageId),
          structuredClone(input.message),
        ].slice(-MAX_RECENT_MESSAGES);
      }
      return true;
    }, { step: 'advance', scope: input.scope, sessionId: input.sessionId, seq: input.seq });
  }

  async completeInitialHistory(
    scope: string,
    workspaceCwd: string,
    sessionId: string,
    deliveredThroughSeq: number,
  ): Promise<boolean> {
    return this.commit(async () => {
      const binding = this.data.bindings[keyFor(scope, workspaceCwd)];
      if (!binding || binding.sessionId !== sessionId || binding.pendingHistoryThroughSeq === undefined) {
        return false;
      }
      binding.lastProjectedSeq = Math.max(binding.lastProjectedSeq, deliveredThroughSeq);
      delete binding.pendingHistoryThroughSeq;
      return true;
    }, { step: 'complete-initial-history', scope, sessionId, seq: deliveredThroughSeq });
  }

  async recordCorrelation(
    scope: string,
    workspaceCwd: string,
    sessionId: string,
    correlation: PromptCorrelation,
  ): Promise<void> {
    await this.commit(async () => {
      const binding = this.data.bindings[keyFor(scope, workspaceCwd)];
      if (!binding || binding.sessionId !== sessionId) return;
      const cutoff = Date.now() - PROMPT_CORRELATION_TTL_MS;
      binding.promptCorrelations = [
        ...binding.promptCorrelations.filter(
          (item) => item.rpcId !== correlation.rpcId && item.createdAt >= cutoff,
        ),
        structuredClone(correlation),
      ].slice(-MAX_PROMPT_CORRELATIONS);
    }, { step: 'correlate', scope, sessionId });
  }

  async recordMessage(
    scope: string,
    workspaceCwd: string,
    sessionId: string,
    message: ProjectedMessage,
  ): Promise<boolean> {
    return this.commit(async () => {
      const binding = this.data.bindings[keyFor(scope, workspaceCwd)];
      if (!binding || binding.sessionId !== sessionId) return false;
      binding.recentMessages = [
        ...binding.recentMessages.filter((item) =>
          message.dshMessageId
            ? item.dshMessageId !== message.dshMessageId
            : item.feishuMessageId !== message.feishuMessageId),
        structuredClone(message),
      ].slice(-MAX_RECENT_MESSAGES);
      return true;
    }, { step: 'record-message', scope, sessionId, seq: message.lastSeq });
  }

  correlationFor(scope: string, workspaceCwd: string, rpcId: string): PromptCorrelation | undefined {
    const match = this.data.bindings[keyFor(scope, workspaceCwd)]?.promptCorrelations.find(
      (item) => item.rpcId === rpcId,
    );
    return match ? { ...match } : undefined;
  }

  async flush(): Promise<void> {
    await this.saving;
  }

  private async commit<T>(mutation: () => Promise<T>, fields: Record<string, unknown>): Promise<T> {
    let result!: T;
    const persist = this.saving.then(async () => {
      const previous = structuredClone(this.data);
      try {
        result = await mutation();
        this.assertExclusive();
        await writeFileAtomic(this.path, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
      } catch (error) {
        this.data = previous;
        log.fail('session-projection-store', error, fields);
        throw error;
      }
    });
    this.saving = persist.catch(() => undefined);
    await persist;
    return result;
  }

  private assertExclusive(): void {
    const owners = new Set<string>();
    for (const binding of Object.values(this.data.bindings)) {
      if (owners.has(binding.sessionId)) {
        throw new Error(`session projection state violates exclusive binding: ${binding.sessionId}`);
      }
      owners.add(binding.sessionId);
    }
  }
}

function keyFor(scope: string, workspaceCwd: string): string {
  return JSON.stringify([scope, workspaceCwd]);
}

function cloneBinding(value: SessionProjectionBinding | undefined): SessionProjectionBinding | undefined {
  return value ? structuredClone(value) : undefined;
}

function normalizeBinding(value: unknown): SessionProjectionBinding | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Partial<SessionProjectionBinding>;
  if (
    typeof item.scope !== 'string' || !item.scope ||
    typeof item.workspaceCwd !== 'string' || !item.workspaceCwd ||
    typeof item.sessionId !== 'string' || !item.sessionId ||
    typeof item.chatId !== 'string' || !item.chatId ||
    !Number.isSafeInteger(item.lastProjectedSeq) || (item.lastProjectedSeq ?? -1) < -1
  ) return undefined;
  const recentMessages = Array.isArray(item.recentMessages)
    ? item.recentMessages.flatMap((message) => normalizeMessage(message) ? [normalizeMessage(message)!] : [])
    : [];
  const promptCorrelations = Array.isArray(item.promptCorrelations)
    ? item.promptCorrelations.flatMap((correlation) => normalizeCorrelation(correlation) ? [normalizeCorrelation(correlation)!] : [])
    : [];
  return {
    scope: item.scope,
    workspaceCwd: item.workspaceCwd,
    sessionId: item.sessionId,
    chatId: item.chatId,
    ...(typeof item.threadId === 'string' && item.threadId ? { threadId: item.threadId } : {}),
    lastProjectedSeq: item.lastProjectedSeq as number,
    ...(Number.isSafeInteger(item.pendingHistoryThroughSeq) && (item.pendingHistoryThroughSeq ?? -2) >= -1
      ? { pendingHistoryThroughSeq: item.pendingHistoryThroughSeq as number }
      : {}),
    ...(normalizeActiveTurn(item.activeTurn) ? { activeTurn: normalizeActiveTurn(item.activeTurn)! } : {}),
    recentMessages: recentMessages.slice(-MAX_RECENT_MESSAGES),
    promptCorrelations: promptCorrelations.slice(-MAX_PROMPT_CORRELATIONS),
    boundAt: typeof item.boundAt === 'string' ? item.boundAt : new Date(0).toISOString(),
    generationId: typeof item.generationId === 'string' && item.generationId
      ? item.generationId
      : `${item.scope}:${item.workspaceCwd}:${item.boundAt ?? new Date(0).toISOString()}`,
  };
}

function normalizeMessage(value: unknown): ProjectedMessage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Partial<ProjectedMessage>;
  if (
    !Number.isSafeInteger(item.firstSeq) || !Number.isSafeInteger(item.lastSeq) ||
    typeof item.feishuMessageId !== 'string' || !item.feishuMessageId ||
    (item.role !== 'user' && item.role !== 'assistant') ||
    !['feishu', 'web', 'tui', 'other-dsh-client'].includes(item.source ?? '') ||
    !['text', 'post', 'card'].includes(item.renderMode ?? '') ||
    typeof item.finalized !== 'boolean'
  ) return undefined;
  return {
    ...(typeof item.dshMessageId === 'string' && item.dshMessageId ? { dshMessageId: item.dshMessageId } : {}),
    firstSeq: item.firstSeq as number,
    lastSeq: item.lastSeq as number,
    role: item.role,
    source: item.source as ProjectionSource,
    feishuMessageId: item.feishuMessageId,
    renderMode: item.renderMode as ProjectionRenderMode,
    finalized: item.finalized,
    ...(typeof item.content === 'string' ? { content: item.content } : {}),
  };
}

function normalizeActiveTurn(value: unknown): ActiveTurnState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Partial<ActiveTurnState>;
  return typeof item.turn === 'string' && item.turn && typeof item.feishuOrigin === 'boolean'
    ? { turn: item.turn, feishuOrigin: item.feishuOrigin }
    : undefined;
}

function normalizeCorrelation(value: unknown): PromptCorrelation | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Partial<PromptCorrelation>;
  return typeof item.rpcId === 'string' && item.rpcId &&
    typeof item.feishuMessageId === 'string' && item.feishuMessageId &&
    Number.isSafeInteger(item.createdAt)
    ? { rpcId: item.rpcId, feishuMessageId: item.feishuMessageId, createdAt: item.createdAt as number }
    : undefined;
}
