import { readFile } from 'node:fs/promises';
import { log } from '../../core/logger.js';
import { writeFileAtomic } from '../../platform/atomic-write.js';
import type { SinkChannel, SinkType } from './types.js';

export const SINK_TYPES: readonly SinkType[] = ['telegram', 'wecom'] as const;

interface NotificationChannelData {
  schemaVersion: 1;
  channels: Record<string, SinkChannel>;
}

/**
 * Persisted outbound notification channel configuration
 * (`<profile>/notification-channels.json`, mode 0600). The secrets stored here
 * are the credential for each push-only sink; they are never echoed by the
 * `/channels` / `/status` surfaces, the command layer, or the logger.
 */
export class NotificationChannelStore {
  private data: NotificationChannelData = { schemaVersion: 1, channels: {} };
  private saving: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Partial<NotificationChannelData>;
      const channels: Record<string, SinkChannel> = {};
      for (const [id, value] of Object.entries(parsed.channels ?? {})) {
        const normalized = normalizeChannel(id, value);
        if (normalized) channels[id] = normalized;
      }
      this.data = { schemaVersion: 1, channels };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.data = { schemaVersion: 1, channels: {} };
    }
  }

  list(): SinkChannel[] {
    return Object.values(this.data.channels).map((channel) => ({ ...channel }));
  }

  get(id: string): SinkChannel | undefined {
    const channel = this.data.channels[id];
    return channel ? { ...channel } : undefined;
  }

  async add(channel: SinkChannel): Promise<void> {
    const normalized = normalizeChannel(channel.id, channel);
    if (!normalized) throw new Error('invalid notification channel');
    await this.mutate(() => {
      this.data.channels[normalized.id] = normalized;
    });
  }

  async update(id: string, patch: Partial<Pick<SinkChannel, 'label' | 'enabled' | 'destination' | 'secret' | 'mentionMap'>>): Promise<boolean> {
    const existing = this.data.channels[id];
    if (!existing) return false;
    const next = normalizeChannel(id, { ...existing, ...patch });
    if (!next) return false;
    await this.mutate(() => { this.data.channels[id] = next; });
    return true;
  }

  async setEnabled(id: string, enabled: boolean): Promise<boolean> {
    return this.update(id, { enabled });
  }

  async remove(id: string): Promise<boolean> {
    const existing = this.data.channels[id];
    if (!existing) return false;
    await this.mutate(() => { delete this.data.channels[id]; });
    return true;
  }

  async flush(): Promise<void> { await this.saving; }

  private async mutate(fn: () => void): Promise<void> {
    const snapshot = JSON.stringify(this.data, null, 2) + '\n';
    const previous = JSON.stringify(this.data);
    fn();
    this.saving = this.saving
      .then(async () => {
        await writeFileAtomic(this.path, snapshot, { mode: 0o600 });
      })
      .catch((error: unknown) => {
        // Roll back the in-memory state so a failed persist never leaves a
        // channel half-configured; the on-disk file stays authoritative.
        try { this.data = JSON.parse(previous) as NotificationChannelData; } catch { /* keep prior */ }
        log.fail('notification-channels', error, { step: 'persist' });
        throw error;
      });
    await this.saving;
  }
}

function normalizeChannel(id: string, value: unknown): SinkChannel | undefined {
  if (!value || typeof value !== 'object' || !id.trim()) return undefined;
  const input = value as Partial<SinkChannel>;
  const type = input.type;
  if (type !== 'telegram' && type !== 'wecom') return undefined;
  const label = typeof input.label === 'string' ? input.label.trim() : '';
  const destination = typeof input.destination === 'string' ? input.destination.trim() : '';
  const secret = typeof input.secret === 'string' ? input.secret.trim() : '';
  if (!label || !destination || !secret) return undefined;
  const mentionMap: Record<string, string> = {};
  if (input.mentionMap && typeof input.mentionMap === 'object') {
    for (const [from, to] of Object.entries(input.mentionMap)) {
      if (typeof to === 'string' && to.trim()) mentionMap[from] = to.trim();
    }
  }
  return {
    id: id.trim(),
    type,
    label,
    destination,
    secret,
    enabled: input.enabled !== false,
    ...(Object.keys(mentionMap).length > 0 ? { mentionMap } : {}),
  };
}
