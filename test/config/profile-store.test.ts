import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigStore } from '../../src/config/profile-store.js';

describe('ConfigStore', () => {
  it('serializes cross-process profile writes without dropping another bot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-profile-concurrent-'));
    const path = join(root, 'config.json');
    try {
      const first = new ConfigStore(path);
      const second = new ConfigStore(path);
      await Promise.all([first.load(), second.load()]);
      await first.saveProfile('developer', {
        tenant: 'feishu', appId: 'cli_dev', appSecret: 'dev-secret',
      });
      await second.saveProfile('reviewer', {
        tenant: 'feishu', appId: 'cli_review', appSecret: 'review-secret',
      });
      await first.saveProfile('developer', {
        tenant: 'feishu', appId: 'cli_dev', appSecret: 'dev-secret',
        access: { allowedUsers: ['ou_owner'], admins: ['ou_owner'] },
      });

      const reloaded = new ConfigStore(path);
      await reloaded.load();
      expect(reloaded.listProfiles().map(({ name }) => name)).toEqual(['developer', 'reviewer']);
      expect(reloaded.getProfile('reviewer')?.accounts.appId).toBe('cli_review');
      expect(reloaded.getActiveProfile()).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('persists the active profile with mode 600 content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-profile-'));
    const path = join(root, 'config.json');

    try {
      const store = new ConfigStore(path);
      await store.load();
      await store.saveProfile('default', {
        tenant: 'feishu',
        appId: 'cli_test',
        appSecret: 'secret',
        workspace: '/tmp/project',
        stopGraceMs: 2_000,
        runTimeoutMs: 60_000,
        operatorOpenId: 'ou_owner',
      });

      const reloaded = new ConfigStore(path);
      await reloaded.load();
      const profile = reloaded.getActiveProfile();

      expect(profile?.agentKind).toBe('dsh');
      expect(profile?.accounts.appId).toBe('cli_test');
      expect(profile?.workspaces.default).toBe('/tmp/project');
      expect(profile?.preferences.stopGraceMs).toBe(2_000);
      expect(profile?.preferences.runTimeoutMs).toBe(60_000);
      expect(profile?.access.allowedUsers).toContain('ou_owner');
      expect(profile?.access.admins).toContain('ou_owner');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
