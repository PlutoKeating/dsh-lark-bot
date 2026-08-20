import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PermissionPolicyStore } from '../../src/bot/permission-policy-store.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function storePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-lark-permission-'));
  roots.push(root);
  return join(root, 'permission-policies.json');
}

describe('PermissionPolicyStore', () => {
  it('defaults to ask and persists scope overrides with owner-only permissions', async () => {
    const path = await storePath();
    const store = new PermissionPolicyStore(path);
    await store.load();
    expect(store.get('chat-a')).toBe('ask');
    await store.set('chat-a', 'deny');
    await store.set('chat-b', 'allow');
    await store.flush();

    const restored = new PermissionPolicyStore(path);
    await restored.load();
    expect(restored.get('chat-a')).toBe('deny');
    expect(restored.get('chat-b')).toBe('allow');
    await expect(stat(path).then((value) => value.mode & 0o777)).resolves.toBe(0o600);
  });

  it('drops invalid entries and removes an override when reset to ask', async () => {
    const path = await storePath();
    await writeFile(path, JSON.stringify({ schemaVersion: 1, scopes: { good: 'allow', bad: 'maybe' } }));
    const store = new PermissionPolicyStore(path);
    await store.load();
    expect(store.get('good')).toBe('allow');
    expect(store.get('bad')).toBe('ask');
    await store.set('good', 'ask');
    await store.flush();
    expect(JSON.parse(await readFile(path, 'utf8')).scopes).toEqual({});
  });

  it('rolls back and reports a persistence failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-permission-blocked-'));
    roots.push(root);
    const blocker = join(root, 'not-a-directory');
    await writeFile(blocker, 'blocked');
    const store = new PermissionPolicyStore(join(blocker, 'permission-policies.json'));
    await expect(store.set('chat-a', 'deny')).rejects.toBeDefined();
    expect(store.get('chat-a')).toBe('ask');
  });
});
