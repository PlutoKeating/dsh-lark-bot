import { readFile } from 'node:fs/promises';
import { log } from '../core/logger.js';
import { writeFileAtomic } from '../platform/atomic-write.js';

export type NotificationEvent = 'completed' | 'failed' | 'approval';

export interface NotificationPreference {
  target?: string;
  events: NotificationEvent[];
  mentionUserIds: string[];
  approvalReminderMs: number;
}

interface NotificationPreferenceData {
  schemaVersion: 2;
  scopes: Record<string, NotificationPreference | false>;
}

const EVENTS = new Set<NotificationEvent>(['completed', 'failed', 'approval']);

/** Opt-in notification preferences keyed by immutable bridge scope. */
export class NotificationPreferenceStore {
  private data: NotificationPreferenceData = { schemaVersion: 2, scopes: {} };
  private saving: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Partial<NotificationPreferenceData>;
      const scopes: Record<string, NotificationPreference | false> = {};
      for (const [scope, value] of Object.entries(parsed.scopes ?? {})) {
        if (value === false) {
          scopes[scope] = false;
          continue;
        }
        const normalized = normalizePreference(value);
        if (normalized) scopes[scope] = normalized;
      }
      this.data = { schemaVersion: 2, scopes };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.data = { schemaVersion: 2, scopes: {} };
    }
  }

  get(scope: string): NotificationPreference | undefined {
    const value = this.data.scopes[scope];
    if (value === undefined || value === false) return undefined;
    return { ...value, events: [...value.events], mentionUserIds: [...value.mentionUserIds] };
  }

  resolve(scope: string, fallback: NotificationPreference | undefined): NotificationPreference | undefined {
    const value = this.data.scopes[scope];
    if (value === false) return undefined;
    return this.get(scope) ?? fallback;
  }

  async set(scope: string, preference: NotificationPreference | false | undefined): Promise<void> {
    const normalized = preference === undefined || preference === false
      ? preference
      : normalizePreference(preference);
    if (preference !== undefined && preference !== false && !normalized) {
      throw new Error('invalid notification preference');
    }
    const persist = this.saving.then(async () => {
      const previous = this.data.scopes[scope];
      if (normalized === false) this.data.scopes[scope] = false;
      else if (normalized) this.data.scopes[scope] = normalized;
      else delete this.data.scopes[scope];
      try {
        await writeFileAtomic(this.path, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
      } catch (error) {
        if (previous !== undefined) this.data.scopes[scope] = previous;
        else delete this.data.scopes[scope];
        log.fail('notification-preferences', error, { step: 'persist', scope });
        throw error;
      }
    });
    this.saving = persist.catch(() => undefined);
    await persist;
  }

  async flush(): Promise<void> { await this.saving; }
}

function normalizePreference(value: unknown): NotificationPreference | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as Partial<NotificationPreference>;
  const events = [...new Set((input.events ?? []).filter((event): event is NotificationEvent => EVENTS.has(event as NotificationEvent)))];
  if (events.length === 0) return undefined;
  const approvalReminderMs = input.approvalReminderMs;
  if (!Number.isSafeInteger(approvalReminderMs) || (approvalReminderMs ?? 0) <= 0) return undefined;
  return {
    ...(typeof input.target === 'string' && input.target.trim() ? { target: input.target.trim() } : {}),
    events,
    mentionUserIds: [...new Set((input.mentionUserIds ?? []).filter((id): id is string => typeof id === 'string' && id.trim().length > 0).map((id) => id.trim()))],
    approvalReminderMs: approvalReminderMs as number,
  };
}
