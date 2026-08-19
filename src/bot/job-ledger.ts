import { readFile, rename } from 'node:fs/promises';
import { writeFileAtomic } from '../platform/atomic-write.js';
import { log } from '../core/logger.js';

export type JobState = 'queued' | 'running' | 'completed' | 'failed' | 'interrupted';

export interface DurableQueuedMessage {
  messageId: string;
  scope: string;
  workspaceCwd: string;
  chatId: string;
  chatType: 'p2p' | 'group';
  chatMode?: 'p2p' | 'group' | 'topic';
  senderId: string;
  senderName?: string;
  senderType?: string;
  content: string;
  rawContentType: string;
  resources: unknown[];
  mentions: unknown[];
  mentionAll: boolean;
  mentionedBot: boolean;
  rootId?: string;
  threadId?: string;
  replyToMessageId?: string;
  createTime: number;
}

export interface JobCheckpoint {
  stage: 'queued' | 'starting' | 'thinking' | 'tool' | 'responding' | 'finalizing';
  detail?: string;
  nativeSessionId?: string;
}

export interface JobRecord {
  message: DurableQueuedMessage;
  state: JobState;
  attempts: number;
  receivedAt: number;
  updatedAt: number;
  runId?: string;
  checkpoint?: JobCheckpoint;
  error?: string;
  recoveryNoticePending?: boolean;
}

export interface JobCounts {
  queued: number;
  running: number;
  completed: number;
  failed: number;
  interrupted: number;
}

interface JobLedgerData {
  schemaVersion: 1;
  records: Record<string, JobRecord>;
}

interface JobLedgerOptions {
  now?: () => number;
  maxTerminalRecords?: number;
}

const EMPTY_COUNTS: JobCounts = {
  queued: 0,
  running: 0,
  completed: 0,
  failed: 0,
  interrupted: 0,
};

/**
 * Durable receipt and execution ledger for messages already accepted by the
 * bridge. Mutations resolve only after their atomic snapshot is on disk.
 */
export class JobLedger {
  private data: JobLedgerData = { schemaVersion: 1, records: {} };
  private saving: Promise<void> = Promise.resolve();
  private readonly now: () => number;
  private readonly maxTerminalRecords: number;

  constructor(
    private readonly path: string,
    options: JobLedgerOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.maxTerminalRecords = options.maxTerminalRecords ?? 500;
  }

  async load(): Promise<void> {
    if (this.path === ':memory:') return;
    let raw: string;
    try {
      raw = await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    try {
      this.data = parseLedger(raw);
    } catch {
      const backup = `${this.path}.corrupt-${String(this.now())}`;
      await rename(this.path, backup);
      this.data = { schemaVersion: 1, records: {} };
      log.warn('job-ledger', 'corrupt-file-moved', { path: this.path, backup });
    }
  }

  async enqueue(message: DurableQueuedMessage): Promise<boolean> {
    if (this.data.records[message.messageId]) return false;
    const now = this.now();
    let inserted = false;
    await this.commit(() => {
      if (this.data.records[message.messageId]) return;
      this.data.records[message.messageId] = {
        message: structuredClone(message),
        state: 'queued',
        attempts: 1,
        receivedAt: now,
        updatedAt: now,
        checkpoint: { stage: 'queued' },
      };
      inserted = true;
    });
    return inserted;
  }

  queued(): JobRecord[] {
    return this.all()
      .filter((record) => record.state === 'queued')
      .sort((a, b) => a.receivedAt - b.receivedAt);
  }

  running(): JobRecord[] {
    return this.all()
      .filter((record) => record.state === 'running')
      .sort((a, b) => a.receivedAt - b.receivedAt);
  }

  pendingRecoveryNotices(): JobRecord[] {
    return this.all()
      .filter((record) => record.state === 'interrupted' && record.recoveryNoticePending === true)
      .sort((a, b) => a.receivedAt - b.receivedAt);
  }

  async markRunning(messageIds: readonly string[], runId: string): Promise<void> {
    const now = this.now();
    await this.commit(() => {
      const unavailable = messageIds.find((id) => this.data.records[id]?.state !== 'queued');
      if (unavailable) throw new Error(`job is not queued: ${unavailable}`);
      for (const id of messageIds) {
        const record = this.data.records[id]!;
        record.state = 'running';
        record.runId = runId;
        record.updatedAt = now;
        record.checkpoint = { stage: 'starting' };
        delete record.error;
      }
    });
  }

  async checkpoint(
    messageIds: readonly string[],
    checkpoint: JobCheckpoint,
    runId?: string,
  ): Promise<void> {
    const now = this.now();
    await this.commit(() => {
      for (const id of messageIds) {
        const record = this.data.records[id];
        if (!record || record.state !== 'running') continue;
        record.checkpoint = { ...checkpoint };
        if (runId) record.runId = runId;
        record.updatedAt = now;
      }
    });
  }

  async finish(
    messageIds: readonly string[],
    state: Extract<JobState, 'completed' | 'failed' | 'interrupted'>,
    error?: string,
  ): Promise<void> {
    const now = this.now();
    await this.commit(() => {
      for (const id of messageIds) {
        const record = this.data.records[id];
        if (!record) continue;
        record.state = state;
        record.updatedAt = now;
        if (error) record.error = error;
        else delete record.error;
      }
      this.pruneTerminal();
    });
  }

  async recoverInterrupted(messageIds?: readonly string[]): Promise<JobRecord[]> {
    const recovered: JobRecord[] = [];
    const selected = messageIds ? new Set(messageIds) : undefined;
    const now = this.now();
    await this.commit(() => {
      for (const record of Object.values(this.data.records)) {
        if (record.state !== 'running') continue;
        if (selected && !selected.has(record.message.messageId)) continue;
        record.state = 'interrupted';
        record.updatedAt = now;
        record.error = 'bridge process stopped before a terminal result was recorded';
        record.recoveryNoticePending = true;
        recovered.push(structuredClone(record));
      }
      this.pruneTerminal();
    });
    return recovered;
  }

  async markRecoveryNotified(messageId: string): Promise<void> {
    await this.commit(() => {
      const record = this.data.records[messageId];
      if (!record || record.state !== 'interrupted') return;
      delete record.recoveryNoticePending;
      record.updatedAt = this.now();
    });
  }

  async retry(messageId: string, scope: string, workspaceCwd: string): Promise<JobRecord | undefined> {
    let result: JobRecord | undefined;
    const now = this.now();
    await this.commit(() => {
      const record = this.data.records[messageId];
      if (
        !record ||
        record.message.scope !== scope ||
        record.message.workspaceCwd !== workspaceCwd ||
        (record.state !== 'failed' && record.state !== 'interrupted')
      ) return;
      record.state = 'queued';
      record.attempts += 1;
      record.updatedAt = now;
      record.checkpoint = { stage: 'queued' };
      delete record.runId;
      delete record.error;
      delete record.recoveryNoticePending;
      result = structuredClone(record);
    });
    return result;
  }

  list(scope: string, workspaceCwd: string, limit = 20): JobRecord[] {
    return this.all()
      .filter((record) =>
        record.message.scope === scope && record.message.workspaceCwd === workspaceCwd)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, Math.max(0, limit));
  }

  get(messageId: string, scope: string, workspaceCwd: string): JobRecord | undefined {
    const record = this.data.records[messageId];
    if (
      !record ||
      record.message.scope !== scope ||
      record.message.workspaceCwd !== workspaceCwd
    ) return undefined;
    return structuredClone(record);
  }

  counts(scope: string, workspaceCwd: string): JobCounts {
    const counts = { ...EMPTY_COUNTS };
    for (const record of this.data.records ? Object.values(this.data.records) : []) {
      if (record.message.scope !== scope || record.message.workspaceCwd !== workspaceCwd) continue;
      counts[record.state] += 1;
    }
    return counts;
  }

  async flush(): Promise<void> {
    await this.saving;
  }

  private all(): JobRecord[] {
    return Object.values(this.data.records).map((record) => structuredClone(record));
  }

  private async commit(mutate: () => void): Promise<void> {
    const operation = this.saving.catch(() => undefined).then(async () => {
      const previous = structuredClone(this.data);
      try {
        mutate();
        if (this.path === ':memory:') return;
        await writeFileAtomic(this.path, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
      } catch (error) {
        this.data = previous;
        throw error;
      }
    });
    this.saving = operation;
    await operation;
  }

  private pruneTerminal(): void {
    const terminal = Object.entries(this.data.records)
      .filter(([, record]) => record.state !== 'queued' && record.state !== 'running')
      .sort(([, a], [, b]) => b.updatedAt - a.updatedAt);
    for (const [id] of terminal.slice(this.maxTerminalRecords)) delete this.data.records[id];
  }
}

function parseLedger(raw: string): JobLedgerData {
  const value = JSON.parse(raw) as Partial<JobLedgerData>;
  if (value.schemaVersion !== 1 || !value.records || typeof value.records !== 'object' || Array.isArray(value.records)) {
    throw new Error('unsupported or malformed job ledger');
  }
  const records: Record<string, JobRecord> = {};
  for (const [id, rawRecord] of Object.entries(value.records)) {
    if (!rawRecord || typeof rawRecord !== 'object' || Array.isArray(rawRecord)) {
      throw new Error(`malformed job record: ${id}`);
    }
    const record = rawRecord as Partial<JobRecord>;
    if (
      !record.message ||
      record.message.messageId !== id ||
      !isJobState(record.state) ||
      typeof record.receivedAt !== 'number' ||
      typeof record.updatedAt !== 'number'
    ) throw new Error(`malformed job record: ${id}`);
    records[id] = record as JobRecord;
  }
  return { schemaVersion: 1, records };
}

function isJobState(value: unknown): value is JobState {
  return value === 'queued' || value === 'running' || value === 'completed' ||
    value === 'failed' || value === 'interrupted';
}
