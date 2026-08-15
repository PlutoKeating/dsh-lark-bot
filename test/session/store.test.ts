import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SessionStore } from '../../src/session/store.js';

describe('SessionStore', () => {
  it('resolves a live session id back to its scope', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-session-'));
    try {
      const store = new SessionStore(join(root, 'sessions.json'));
      store.set('chat-a', 'session-1', '/tmp/project-a');
      store.set('chat-b', 'session-2', '/tmp/project-b');
      expect(store.scopeForSession('session-1')).toBe('chat-a');
      expect(store.scopeForSession('session-2')).toBe('chat-b');
      expect(store.scopeForSession('session-3')).toBeUndefined();
      // set() schedules an asynchronous persist; flush it before the temp dir
      // is removed so writeFileAtomic's temp file cannot race with rmdir
      // (ENOTEMPTY flake under load).
      await store.flush();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('persists and restores session bindings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-session-'));
    const path = join(root, 'sessions.json');

    try {
      const store = new SessionStore(path);
      store.set('chat-a', 'session-1', '/tmp/project-a');
      store.recordExchange('chat-a', '/tmp/project-a', ['hello'], 'hi there');
      await store.flush();

      const reloaded = new SessionStore(path);
      await reloaded.load();

      expect(reloaded.resumeFor('chat-a', '/tmp/project-a')).toBe('session-1');
      expect(reloaded.resumeFor('chat-a', '/tmp/other')).toBeUndefined();
      expect(reloaded.historyFor('chat-a', '/tmp/project-a')).toEqual([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi there' },
      ]);

      expect(reloaded.fork('chat-a', 'chat-b', '/tmp/project-a')).toBe(true);
      expect(reloaded.historyFor('chat-b', '/tmp/project-a')).toEqual([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi there' },
      ]);
      expect(reloaded.resumeFor('chat-b', '/tmp/project-a')).toBeUndefined();
      // fork schedules an asynchronous persist; flush it before the temp dir
      // is removed so writeFileAtomic's temp file cannot race with rmdir
      // (ENOTEMPTY flake under load).
      await reloaded.flush();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('clears the native session binding while keeping the transcript', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-session-'));
    const path = join(root, 'sessions.json');

    try {
      const store = new SessionStore(path);
      store.set('chat-a', 'session-1', '/tmp/project-a');
      store.recordExchange('chat-a', '/tmp/project-a', ['hello'], 'hi there');
      await store.flush();

      store.clearSession('chat-a');
      await store.flush();

      expect(store.resumeFor('chat-a', '/tmp/project-a')).toBeUndefined();
      expect(store.historyFor('chat-a', '/tmp/project-a')).toEqual([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi there' },
      ]);

      const reloaded = new SessionStore(path);
      await reloaded.load();
      expect(reloaded.resumeFor('chat-a', '/tmp/project-a')).toBeUndefined();
      expect(reloaded.historyFor('chat-a', '/tmp/project-a')).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('archives overflow beyond the retention window', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-session-'));
    const path = join(root, 'sessions.json');
    const archived: unknown[] = [];

    try {
      const store = new SessionStore(path);
      store.recordExchange('chat-a', '/tmp/project', ['one'], 'r1', {
        retention: 2,
        onArchive: (overflow) => {
          archived.push(overflow);
        },
      });
      store.recordExchange('chat-a', '/tmp/project', ['two'], 'r2', {
        retention: 2,
        onArchive: (overflow) => {
          archived.push(overflow);
        },
      });
      await store.flush();

      expect(archived).toEqual([
        [{ role: 'user', content: 'one' }, { role: 'assistant', content: 'r1' }],
      ]);
      expect(store.historyFor('chat-a', '/tmp/project')).toEqual([
        { role: 'user', content: 'two' },
        { role: 'assistant', content: 'r2' },
      ]);
      expect(store.fullHistoryFor('chat-a', '/tmp/project')).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
