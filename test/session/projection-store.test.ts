import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SessionProjectionStore } from '../../src/session/projection-store.js';

describe('SessionProjectionStore', () => {
  it('persists exclusive binding, cursor, message mapping and correlation across restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-projection-'));
    const path = join(root, 'projection.json');
    const store = new SessionProjectionStore(path);
    await store.load();
    await store.bindExclusive({
      scope: 'chat-old', workspaceCwd: '/repo', sessionId: 'session-a',
      chatId: 'chat-old', initialSeq: 4,
    });
    const result = await store.bindExclusive({
      scope: 'chat-new:thread-a', workspaceCwd: '/repo', sessionId: 'session-a',
      chatId: 'chat-new', threadId: 'thread-a', initialSeq: 8, allowCrossScopeMigration: true,
      expectedOwner: { scope: 'chat-old', workspaceCwd: '/repo' },
    });
    expect(result.displaced?.scope).toBe('chat-old');
    expect(store.get('chat-old', '/repo')).toBeUndefined();

    await store.recordCorrelation('chat-new:thread-a', '/repo', 'session-a', {
      rpcId: 'rpc-a', feishuMessageId: 'message-user', createdAt: Date.now(),
    });
    await store.recordMessage('chat-new:thread-a', '/repo', 'session-a', {
      dshMessageId: 'dsh-a', firstSeq: 9, lastSeq: 9, role: 'user', source: 'feishu',
      feishuMessageId: 'message-user', renderMode: 'text', finalized: true,
    });
    expect(await store.advance({
      scope: 'chat-new:thread-a', workspaceCwd: '/repo', sessionId: 'session-a', seq: 9,
    })).toBe(true);
    expect(await store.advance({
      scope: 'chat-new:thread-a', workspaceCwd: '/repo', sessionId: 'session-a', seq: 9,
    })).toBe(false);

    const restored = new SessionProjectionStore(path);
    await restored.load();
    expect(restored.ownerOf('session-a')).toMatchObject({
      scope: 'chat-new:thread-a', threadId: 'thread-a', lastProjectedSeq: 9,
    });
    expect(restored.correlationFor('chat-new:thread-a', '/repo', 'rpc-a')?.feishuMessageId)
      .toBe('message-user');
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(path, 'utf8')).schemaVersion).toBe(1);
  });

  it('atomically rejects cross-scope displacement without migration authority', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-projection-migration-'));
    const store = new SessionProjectionStore(join(root, 'projection.json'));
    await store.load();
    await store.bindExclusive({
      scope: 'chat-old', workspaceCwd: '/repo', sessionId: 'session-a', chatId: 'chat-old', initialSeq: 1,
    });
    await expect(store.bindExclusive({
      scope: 'chat-new', workspaceCwd: '/repo', sessionId: 'session-a', chatId: 'chat-new', initialSeq: 2,
      expectedOwner: { scope: 'chat-old', workspaceCwd: '/repo' },
    })).rejects.toThrow('not authorized');
    expect(store.ownerOf('session-a')?.scope).toBe('chat-old');
  });

  it('rejects a loaded state that assigns one DSH session to multiple scopes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-projection-invalid-'));
    const path = join(root, 'projection.json');
    const store = new SessionProjectionStore(path);
    await store.load();
    await store.bindExclusive({ scope: 'a', workspaceCwd: '/repo', sessionId: 'sid', chatId: 'a', initialSeq: -1 });
    const raw = JSON.parse(await readFile(path, 'utf8')) as { bindings: Record<string, unknown> };
    const first = Object.values(raw.bindings)[0] as Record<string, unknown>;
    raw.bindings.second = { ...first, scope: 'b', chatId: 'b' };
    await import('node:fs/promises').then(({ writeFile }) => writeFile(path, JSON.stringify(raw)));
    await expect(new SessionProjectionStore(path).load()).rejects.toThrow('exclusive binding');
  });

  it('rolls back memory and reports failure when the atomic durable write fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-projection-failure-'));
    const blocker = join(root, 'not-a-directory');
    const store = new SessionProjectionStore(join(blocker, 'projection.json'));
    await store.load();
    await writeFile(blocker, 'block mkdir');
    await expect(store.bindExclusive({
      scope: 'chat-a', workspaceCwd: '/repo', sessionId: 's1', chatId: 'chat-a', initialSeq: -1,
    })).rejects.toThrow();
    expect(store.list()).toEqual([]);
  });
});
