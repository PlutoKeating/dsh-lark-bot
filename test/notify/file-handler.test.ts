import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionStore } from '../../src/session/store.js';
import { ScopeDirectory } from '../../src/bridge/scope-directory.js';
import { buildFileHandler } from '../../src/notify/file-handler.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('buildFileHandler', () => {
  it('routes a session-owned file to its topic and preserves the reply anchor', async () => {
    const root = await mkdtemp(join(tmpdir(), 'file-handler-'));
    roots.push(root);
    await writeFile(join(root, 'report.md'), 'result');
    const sessions = new SessionStore(':memory:');
    sessions.set('chat-a:thread-a', 'session-1', root);
    const directory = new ScopeDirectory(':memory:');
    directory.register('chat-a:thread-a', 'chat-a', 'thread-a', 'topic', 'root-message');
    const sendFile = vi.fn().mockResolvedValue(undefined);
    const handler = buildFileHandler({ sessions, scopeDirectory: directory, allowedRoots: () => [root], channel: { sendFile } });
    await expect(handler({ token: 't', sessionId: 'session-1', path: 'report.md', runtimeCwd: root })).resolves.toEqual({ ok: true, fileName: 'report.md', size: 6 });
    expect(sendFile).toHaveBeenCalledWith('chat-a', 'report.md', Buffer.from('result'), { threadId: 'thread-a', replyTo: 'root-message' });
  });

  it('returns explicit errors for unknown sessions and oversized files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'file-handler-'));
    roots.push(root);
    await writeFile(join(root, 'large.bin'), '12345');
    const sessions = new SessionStore(':memory:');
    sessions.set('chat-a', 'session-1', root);
    const directory = new ScopeDirectory(':memory:');
    directory.register('chat-a', 'chat-a', undefined);
    const handler = buildFileHandler({ sessions, scopeDirectory: directory, allowedRoots: () => [root], maxBytes: 4, channel: { sendFile: vi.fn() } });
    await expect(handler({ token: 't', sessionId: 'missing', path: 'x' })).resolves.toEqual({ ok: false, error: 'unknown session: missing' });
    await expect(handler({ token: 't', sessionId: 'session-1', path: 'large.bin', runtimeCwd: root })).resolves.toEqual(expect.objectContaining({ ok: false, error: expect.stringContaining('too large') }));
  });

  it('awaits session-specific roots instead of trusting the runtime cwd', async () => {
    const root = await mkdtemp(join(tmpdir(), 'file-handler-'));
    const outside = await mkdtemp(join(tmpdir(), 'file-handler-outside-'));
    roots.push(root, outside);
    await writeFile(join(outside, 'secret.txt'), 'secret');
    const sessions = new SessionStore(':memory:');
    sessions.set('chat-a', 'session-1', root);
    const directory = new ScopeDirectory(':memory:');
    directory.register('chat-a', 'chat-a', undefined);
    const allowedRoots = vi.fn().mockResolvedValue([root]);
    const handler = buildFileHandler({ sessions, scopeDirectory: directory, allowedRoots, channel: { sendFile: vi.fn() } });

    await expect(handler({ token: 't', sessionId: 'session-1', path: 'secret.txt', runtimeCwd: outside })).resolves.toEqual(
      expect.objectContaining({ ok: false, error: expect.stringContaining('outside the current workspace') }),
    );
    expect(allowedRoots).toHaveBeenCalledWith('session-1', 'chat-a', root);
  });
});
