import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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

      store.clearSession('chat-a', '/tmp/project-a');
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

  it('persists cumulative token metrics and clears them with the session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-session-'));
    const path = join(root, 'sessions.json');

    try {
      const store = new SessionStore(path);
      store.set('chat-a', 'session-1', '/tmp/project-a');
      store.recordUsage('chat-a', '/tmp/project-a', {
        inputTokens: 10,
        outputTokens: 4,
        cacheReadTokens: 20,
      });
      store.recordUsage('chat-a', '/tmp/project-a', {
        inputTokens: 3,
        outputTokens: 2,
        cacheWriteTokens: 5,
      });
      store.recordContextUsage('chat-a', '/tmp/project-a', {
        usedTokens: 32,
        contextWindow: 128,
        sessionId: 'session-1',
        model: 'gateway/model-a',
      });
      store.recordContextUsage('chat-a', '/tmp/project-a', {
        usedTokens: 64,
        contextWindow: 256,
        sessionId: 'session-2',
        model: 'gateway/model-b',
      });
      await store.flush();

      const reloaded = new SessionStore(path);
      await reloaded.load();
      expect(reloaded.metricsFor('chat-a', '/tmp/project-a', {
        sessionId: 'session-1',
        model: 'gateway/model-a',
      })).toEqual({
        inputTokens: 13,
        outputTokens: 6,
        cacheReadTokens: 20,
        cacheWriteTokens: 5,
        contextUsedTokens: 32,
        contextWindow: 128,
      });
      expect(reloaded.metricsFor('chat-a', '/tmp/project-a', {
        sessionId: 'session-2',
        model: 'gateway/model-b',
      })).toEqual({
        inputTokens: 13,
        outputTokens: 6,
        cacheReadTokens: 20,
        cacheWriteTokens: 5,
        contextUsedTokens: 64,
        contextWindow: 256,
      });
      expect(reloaded.metricsFor('chat-a', '/tmp/project-a', {
        sessionId: 'session-3',
        model: 'gateway/model-c',
      })).toEqual({
        inputTokens: 13,
        outputTokens: 6,
        cacheReadTokens: 20,
        cacheWriteTokens: 5,
      });

      expect(reloaded.clear('chat-a', '/tmp/project-a')).toBe(true);
      expect(reloaded.metricsFor('chat-a', '/tmp/project-a')).toBeUndefined();
      await reloaded.flush();
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

  it('keeps independent sessions and metrics when one scope switches workspaces', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-session-workspaces-'));
    const path = join(root, 'sessions.json');
    try {
      const store = new SessionStore(path);
      store.set('chat-a', 'session-a', '/tmp/project-a');
      store.recordExchange('chat-a', '/tmp/project-a', ['question a'], 'answer a');
      store.recordUsage('chat-a', '/tmp/project-a', { inputTokens: 10 });
      store.set('chat-a', 'session-b', '/tmp/project-b');
      store.recordExchange('chat-a', '/tmp/project-b', ['question b'], 'answer b');
      store.recordUsage('chat-a', '/tmp/project-b', { inputTokens: 20 });
      await store.flush();

      const reloaded = new SessionStore(path);
      await reloaded.load();
      expect(reloaded.resumeFor('chat-a', '/tmp/project-a')).toBe('session-a');
      expect(reloaded.resumeFor('chat-a', '/tmp/project-b')).toBe('session-b');
      expect(reloaded.historyFor('chat-a', '/tmp/project-a')[0]?.content).toBe('question a');
      expect(reloaded.historyFor('chat-a', '/tmp/project-b')[0]?.content).toBe('question b');
      expect(reloaded.metricsFor('chat-a', '/tmp/project-a')).toEqual({ inputTokens: 10 });
      expect(reloaded.metricsFor('chat-a', '/tmp/project-b')).toEqual({ inputTokens: 20 });

      expect(reloaded.clear('chat-a', '/tmp/project-b')).toBe(true);
      expect(reloaded.resumeFor('chat-a', '/tmp/project-a')).toBe('session-a');
      expect(reloaded.resumeFor('chat-a', '/tmp/project-b')).toBeUndefined();
      await reloaded.flush();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('migrates a schema-1 scope to the workspace selected at upgrade time', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-session-legacy-'));
    const path = join(root, 'sessions.json');
    try {
      await writeFile(path, JSON.stringify({
        chats: {
          'chat-a': {
            sessionId: 'legacy-session',
            cwd: '/tmp/generated-worktree',
            messages: [{ role: 'user', content: 'legacy context' }],
          },
        },
        metrics: { 'chat-a': { inputTokens: 7 } },
      }));
      const store = new SessionStore(path);
      await store.load();
      expect(store.legacyWorkspaceCwd('chat-a')).toBe('/tmp/generated-worktree');
      expect(store.adoptLegacyWorkspace('chat-a', '/tmp/project-a')).toBe(true);
      expect(store.legacyWorkspaceCwd('chat-a')).toBeUndefined();
      expect(store.resumeFor('chat-a', '/tmp/project-a')).toBe('legacy-session');
      expect(store.historyFor('chat-a', '/tmp/project-a')[0]?.content).toBe('legacy context');
      expect(store.metricsFor('chat-a', '/tmp/project-a')).toEqual({ inputTokens: 7 });
      await store.flush();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
