import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SessionStore } from '../../src/session/store.js';

describe('SessionStore', () => {
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
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
