import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigStore } from '../../src/config/profile-store.js';

describe('ConfigStore', () => {
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
      });

      const reloaded = new ConfigStore(path);
      await reloaded.load();
      const profile = reloaded.getActiveProfile();

      expect(profile?.agentKind).toBe('dsh');
      expect(profile?.accounts.appId).toBe('cli_test');
      expect(profile?.workspaces.default).toBe('/tmp/project');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
