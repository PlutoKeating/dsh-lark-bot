import { readFile } from 'node:fs/promises';
import { log } from '../core/logger.js';
import { writeFileAtomic } from '../platform/atomic-write.js';

export interface ReplyPolicy {
  mergeWindowMs: number;
  maxBatchSize: number;
  minIntervalMs: number;
  dedupeWindowMs: number;
}

export const DEFAULT_REPLY_POLICY: Readonly<ReplyPolicy> = Object.freeze({
  mergeWindowMs: 0,
  maxBatchSize: 1,
  minIntervalMs: 0,
  dedupeWindowMs: 0,
});

interface ReplyPolicyData {
  schemaVersion: 1;
  scopes: Record<string, ReplyPolicy>;
}

export class ReplyPolicyStore {
  private data: ReplyPolicyData = { schemaVersion: 1, scopes: {} };
  private saving: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Partial<ReplyPolicyData>;
      this.data = {
        schemaVersion: 1,
        scopes: Object.fromEntries(Object.entries(parsed.scopes ?? {}).flatMap(([scope, value]) => {
          const policy = normalizeReplyPolicy(value);
          return policy ? [[scope, policy]] : [];
        })),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.data = { schemaVersion: 1, scopes: {} };
    }
  }

  get(scope: string): ReplyPolicy {
    return { ...(this.data.scopes[scope] ?? DEFAULT_REPLY_POLICY) };
  }

  isConfigured(scope: string): boolean {
    return this.data.scopes[scope] !== undefined;
  }

  async set(scope: string, policy: ReplyPolicy | undefined): Promise<void> {
    const normalized = policy === undefined ? undefined : normalizeReplyPolicy(policy);
    if (policy !== undefined && !normalized) throw new Error('invalid reply policy');
    const persist = this.saving.then(async () => {
      const previous = this.data.scopes[scope];
      if (normalized) this.data.scopes[scope] = normalized;
      else delete this.data.scopes[scope];
      try {
        await writeFileAtomic(this.path, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
      } catch (error) {
        if (previous) this.data.scopes[scope] = previous;
        else delete this.data.scopes[scope];
        log.fail('reply-policy', error, { step: 'persist', scope });
        throw error;
      }
    });
    this.saving = persist.catch(() => undefined);
    await persist;
  }

  async flush(): Promise<void> { await this.saving; }
}

function normalizeReplyPolicy(value: unknown): ReplyPolicy | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as Partial<ReplyPolicy>;
  if (!integerBetween(input.mergeWindowMs, 0, 300_000)) return undefined;
  if (!integerBetween(input.maxBatchSize, 1, 20)) return undefined;
  if (!integerBetween(input.minIntervalMs, 0, 3_600_000)) return undefined;
  if (!integerBetween(input.dedupeWindowMs, 0, 3_600_000)) return undefined;
  return {
    mergeWindowMs: input.mergeWindowMs,
    maxBatchSize: input.maxBatchSize,
    minIntervalMs: input.minIntervalMs,
    dedupeWindowMs: input.dedupeWindowMs,
  };
}

function integerBetween(value: unknown, min: number, max: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
}
