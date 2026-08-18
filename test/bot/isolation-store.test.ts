import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { IsolationStore } from '../../src/bot/isolation-store.js';
import {
  isolatedScope,
  memberOwnerForScope,
  reachableScopes,
} from '../../src/bridge/scope-isolation.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('scope isolation', () => {
  it('keeps the legacy group/topic behavior by default and supports member scopes', () => {
    expect(isolatedScope({ chatId: 'chat', chatMode: 'group', senderId: 'u1' }, 'topic')).toBe('chat');
    expect(isolatedScope({ chatId: 'chat', chatMode: 'topic', threadId: 't1', senderId: 'u1' }, 'topic')).toBe('chat:t1');
    expect(isolatedScope({ chatId: 'chat', chatMode: 'topic', threadId: 't1', senderId: 'u1' }, 'group')).toBe('chat');
    expect(isolatedScope({ chatId: 'chat', chatMode: 'topic', threadId: 't1', senderId: 'u1' }, 'member')).toBe('chat:member:u1');
    expect(isolatedScope({ chatId: 'dm', chatMode: 'p2p', senderId: 'u1' }, 'member')).toBe('dm');
    expect(() => isolatedScope({ chatId: 'chat', chatMode: 'group' }, 'member')).toThrow(
      'requires a sender identity',
    );
  });

  it('keeps immutable owner and reachable scopes across policy switches', () => {
    expect(memberOwnerForScope('chat:member:u1', 'chat')).toBe('u1');
    expect(memberOwnerForScope('chat:thread-1', 'chat')).toBeUndefined();
    expect(reachableScopes({
      chatId: 'chat',
      chatMode: 'topic',
      threadId: 'thread-1',
      senderId: 'u1',
    })).toEqual(['chat', 'chat:thread-1', 'chat:member:u1']);
  });

  it('persists mode changes without touching any session data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-isolation-'));
    roots.push(root);
    const path = join(root, 'isolation.json');
    const store = new IsolationStore(path);
    await store.load();
    expect(store.get('chat')).toBe('topic');
    store.set('chat', 'member');
    await store.flush();

    const reloaded = new IsolationStore(path);
    await reloaded.load();
    expect(reloaded.get('chat')).toBe('member');
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      schemaVersion: 1,
      chats: { chat: 'member' },
    });
  });
});
