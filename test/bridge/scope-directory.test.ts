import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ScopeDirectory } from '../../src/bridge/scope-directory.js';

describe('ScopeDirectory', () => {
  it('registers and resolves scope destinations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-scopes-'));
    const path = join(root, 'scopes.json');
    try {
      const dir = new ScopeDirectory(path);
      await dir.load();
      dir.register('chat-a', 'oc_group', undefined, 'group');
      dir.register('chat-b:thread-1', 'oc_topic', 'thread-1', 'topic');
      await dir.flush();

      expect(dir.resolve('chat-a')).toEqual({ chatId: 'oc_group', threadId: undefined });
      expect(dir.resolve('chat-b:thread-1')).toEqual({
        chatId: 'oc_topic',
        threadId: 'thread-1',
      });
      expect(dir.resolveChat('oc_group')).toEqual({ chatId: 'oc_group', threadId: undefined });
      expect(dir.resolve('unknown')).toBeUndefined();

      const reloaded = new ScopeDirectory(path);
      await reloaded.load();
      expect(reloaded.resolve('chat-b:thread-1')?.threadId).toBe('thread-1');
      expect(reloaded.knownScopes().sort()).toEqual(['chat-a', 'chat-b:thread-1']);
      expect(reloaded.knownChats()).toEqual([
        { chatId: 'oc_group', chatMode: 'group' },
        { chatId: 'oc_topic', chatMode: 'topic' },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
