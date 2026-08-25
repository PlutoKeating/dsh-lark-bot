import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NotificationPreferenceStore } from '../../src/bot/notification-preference-store.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('NotificationPreferenceStore', () => {
  it('persists opt-in scope preferences and reloads them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'notify-prefs-'));
    roots.push(root);
    const path = join(root, 'preferences.json');
    const store = new NotificationPreferenceStore(path);
    await store.load();
    expect(store.get('chat-a')).toBeUndefined();
    await store.set('chat-a', { target: 'chat-b', events: ['completed', 'approval'], mentionUserIds: ['ou_a'], sinks: ['tg-main'], approvalReminderMs: 60_000 });
    const reloaded = new NotificationPreferenceStore(path);
    await reloaded.load();
    expect(reloaded.get('chat-a')).toEqual({ target: 'chat-b', events: ['completed', 'approval'], mentionUserIds: ['ou_a'], sinks: ['tg-main'], approvalReminderMs: 60_000 });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const fallback = { events: ['failed'] as const, mentionUserIds: [], sinks: [], approvalReminderMs: 60_000 };
    await reloaded.set('chat-a', false);
    expect(reloaded.resolve('chat-a', { ...fallback, events: [...fallback.events] })).toBeUndefined();
    const disabled = new NotificationPreferenceStore(path);
    await disabled.load();
    expect(disabled.resolve('chat-a', { ...fallback, events: [...fallback.events] })).toBeUndefined();
    await reloaded.set('chat-a', undefined);
    expect(reloaded.get('chat-a')).toBeUndefined();
    expect(reloaded.resolve('chat-a', { ...fallback, events: [...fallback.events] })).toEqual(fallback);
  });

  it('rolls back the in-memory value when durable persistence fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'notify-prefs-'));
    roots.push(root);
    const blocked = join(root, 'not-a-directory');
    const store = new NotificationPreferenceStore(join(blocked, 'preferences.json'));
    await mkdir(blocked);
    await store.load();
    await rm(blocked, { recursive: true });
    await writeFile(blocked, 'x');
    await expect(store.set('chat-a', { events: ['completed'], mentionUserIds: [], sinks: [], approvalReminderMs: 60_000 })).rejects.toThrow();
    expect(store.get('chat-a')).toBeUndefined();
  });
});
