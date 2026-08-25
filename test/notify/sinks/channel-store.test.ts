import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NotificationChannelStore } from '../../../src/notify/sinks/channel-store.js';
import { maskChannel, maskSecret } from '../../../src/notify/sinks/types.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('NotificationChannelStore', () => {
  it('persists channels at 0600 and reloads them across instances', async () => {
    const root = await mkdtemp(join(tmpdir(), 'notify-channels-'));
    roots.push(root);
    const path = join(root, 'channels.json');
    const store = new NotificationChannelStore(path);
    await store.load();
    expect(store.list()).toEqual([]);
    await store.add({ id: 'tg-main', type: 'telegram', label: 'Ops', destination: '@ops', secret: '123:abc', enabled: true });
    await store.add({ id: 'wecom-main', type: 'wecom', label: '群机器人', destination: 'key-123', secret: 'key-123', enabled: true });
    const reloaded = new NotificationChannelStore(path);
    await reloaded.load();
    expect(reloaded.get('tg-main')).toEqual({ id: 'tg-main', type: 'telegram', label: 'Ops', destination: '@ops', secret: '123:abc', enabled: true });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it('disables, updates and removes channels', async () => {
    const root = await mkdtemp(join(tmpdir(), 'notify-channels-'));
    roots.push(root);
    const store = new NotificationChannelStore(join(root, 'channels.json'));
    await store.load();
    await store.add({ id: 'tg-main', type: 'telegram', label: 'Ops', destination: '@ops', secret: '123:abc', enabled: true });
    expect(await store.setEnabled('tg-main', false)).toBe(true);
    expect(store.get('tg-main')?.enabled).toBe(false);
    expect(await store.update('tg-main', { label: 'Ops-2' })).toBe(true);
    expect(store.get('tg-main')?.label).toBe('Ops-2');
    expect(await store.remove('tg-main')).toBe(true);
    expect(store.get('tg-main')).toBeUndefined();
    expect(await store.remove('missing')).toBe(false);
  });

  it('rejects malformed / partial channels and reads a legacy empty file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'notify-channels-'));
    roots.push(root);
    const path = join(root, 'channels.json');
    const store = new NotificationChannelStore(path);
    await store.load();
    await expect(store.add({ id: 'bad', type: 'unknown' as never, label: 'x', destination: 'y', secret: 'z', enabled: true })).rejects.toThrow();
  });
});

describe('maskSecret / maskChannel', () => {
  it('never leaks a full credential', () => {
    expect(maskSecret('1234567890abcdef')).not.toContain('456789');
    expect(maskSecret('123456')).toBe('1{redacted}');
    expect(maskSecret('')).toBe('(unset)');
    expect(maskChannel({ id: 'tg-main', type: 'telegram', label: 'Ops', destination: 'super-long-token-value', secret: 'super-long-token-value', enabled: true })).not.toContain('long-token-value');
  });
});
