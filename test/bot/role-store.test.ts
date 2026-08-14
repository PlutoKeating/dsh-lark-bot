import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RoleStore } from '../../src/bot/role-store.js';

describe('RoleStore', () => {
  it('persists roles and scope bindings across reloads', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-roles-'));
    const path = join(root, 'roles.json');
    try {
      const store = new RoleStore(path);
      await store.load();
      store.upsert({
        id: 'pm',
        name: 'Product Manager',
        persona: 'You are the PM.',
        model: 'deepseek-v4-pro',
        tools: 'fs,search',
        agentsMd: '1. Focus on scope.',
      });
      expect(store.setScopeRole('chat-a', 'pm')).toBe(true);
      expect(store.setScopeRole('chat-a', 'missing')).toBe(false);
      await store.flush();

      const reloaded = new RoleStore(path);
      await reloaded.load();
      const role = reloaded.roleForScope('chat-a');
      expect(role?.name).toBe('Product Manager');
      expect(role?.model).toBe('deepseek-v4-pro');
      expect(reloaded.list()).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('removes a role and its scope bindings', async () => {
    const store = new RoleStore(':memory:');
    await store.load();
    store.upsert({ id: 'dev', name: 'Developer', persona: 'Write code.' });
    store.setScopeRole('chat-a', 'dev');
    expect(store.remove('dev')).toBe(true);
    expect(store.roleForScope('chat-a')).toBeUndefined();
    expect(store.remove('dev')).toBe(false);
  });
});
