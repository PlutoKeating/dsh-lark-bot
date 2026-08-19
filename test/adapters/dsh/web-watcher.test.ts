import { describe, expect, it } from 'vitest';
import { webWorkspaceCwd } from '../../../src/adapters/dsh/web-watcher.js';
import { SessionStore } from '../../../src/session/store.js';

describe('webWorkspaceCwd', () => {
  it('keeps a bridge-created session on its selected project instead of its execution worktree', () => {
    const sessions = new SessionStore(':memory:');
    sessions.set('chat-a', 'session-a', '/projects/repo');

    expect(webWorkspaceCwd(
      sessions,
      'session-a',
      '/profiles/default/worktrees/chat-a-deadbeef00',
    )).toBe('/projects/repo');
  });

  it('uses persisted execution cwd for an unknown Web-created session', () => {
    const sessions = new SessionStore(':memory:');
    expect(webWorkspaceCwd(sessions, 'web-session', '/projects/web')).toBe('/projects/web');
  });
});
