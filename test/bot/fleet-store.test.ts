import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BotFleetStore, validBotInstanceName } from '../../src/bot/fleet-store.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('BotFleetStore', () => {
  it('persists isolated instances and reloads peer identities across processes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-fleet-'));
    roots.push(root);
    const file = join(root, 'fleet.json');
    const first = new BotFleetStore(file);
    await first.load();
    await first.add({ name: 'developer', bridgeProfile: 'developer', dshProfile: 'dsh-lark-developer', dshHome: join(root, 'developer') });
    await first.add({ name: 'reviewer', bridgeProfile: 'reviewer', dshProfile: 'dsh-lark-reviewer', dshHome: join(root, 'reviewer') });
    await first.registerIdentity('reviewer', { openId: 'ou_reviewer', name: 'Reviewer Bot' });

    const second = new BotFleetStore(file);
    await second.load();
    expect(await second.isTrustedPeer('ou_reviewer', 'developer')).toBe(true);
    expect(await second.peersFor('developer')).toEqual([
      { name: 'reviewer', openId: 'ou_reviewer', displayName: 'Reviewer Bot' },
    ]);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(file, 'utf8')).schemaVersion).toBe(1);
  });

  it('removes only the selected registry row and validates stable names', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-fleet-remove-'));
    roots.push(root);
    const store = new BotFleetStore(join(root, 'fleet.json'));
    await store.load();
    await store.add({ name: 'pm', bridgeProfile: 'pm', dshProfile: 'dsh-lark-pm', dshHome: join(root, 'pm') });
    await store.add({ name: 'dev-2', bridgeProfile: 'dev-2', dshProfile: 'dsh-lark-dev-2', dshHome: join(root, 'dev-2') });

    await store.remove('pm');
    expect(store.list().map((entry) => entry.name)).toEqual(['dev-2']);
    expect(validBotInstanceName('Bad_Name')).toBe(false);
    await expect(store.add({ name: '../bad', bridgeProfile: 'x', dshProfile: 'x', dshHome: join(root, 'bad') })).rejects.toThrow();
  });

  it('rejects two enabled instances bound to the same bot identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-fleet-identity-'));
    roots.push(root);
    const store = new BotFleetStore(join(root, 'fleet.json'));
    await store.load();
    await store.add({ name: 'pm', bridgeProfile: 'pm', dshProfile: 'dsh-lark-pm', dshHome: join(root, 'pm') });
    await store.add({ name: 'dev', bridgeProfile: 'dev', dshProfile: 'dsh-lark-dev', dshHome: join(root, 'dev') });
    await store.registerIdentity('pm', { openId: 'ou_same' });
    await expect(store.registerIdentity('dev', { openId: 'ou_same' })).rejects.toThrow(
      '拒绝启动重复连接',
    );
    expect(store.get('dev')?.startupError).toContain('拒绝启动重复连接');
  });
});
