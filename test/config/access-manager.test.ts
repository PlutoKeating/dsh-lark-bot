import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AccessManager } from '../../src/config/access-manager.js';
import { ConfigStore } from '../../src/config/profile-store.js';

describe('AccessManager', () => {
  it('persists user and chat allowlist changes to the profile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-access-'));
    const store = new ConfigStore(join(root, 'config.json'));
    await store.load();
    await store.saveProfile('default', {
      tenant: 'feishu',
      appId: 'cli_test',
      appSecret: 'secret',
      operatorOpenId: 'ou_owner',
    });

    try {
      const manager = new AccessManager(store, 'default');
      await manager.addUser('ou_user');
      await manager.addChat('oc_chat');

      const reloaded = new ConfigStore(join(root, 'config.json'));
      await reloaded.load();
      const profile = reloaded.getProfile('default');

      expect(profile?.access.allowedUsers).toContain('ou_owner');
      expect(profile?.access.allowedUsers).toContain('ou_user');
      expect(profile?.access.allowedChats).toContain('oc_chat');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
