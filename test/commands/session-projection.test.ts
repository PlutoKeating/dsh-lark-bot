import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AccessManager } from '../../src/config/access-manager.js';
import type { CommandContext } from '../../src/commands/index.js';
import { SessionProjectionController } from '../../src/commands/session-projection.js';
import { ScopeDirectory } from '../../src/bridge/scope-directory.js';
import type { SessionProjectionBridge } from '../../src/session/projection-bridge.js';
import { SessionProjectionStore } from '../../src/session/projection-store.js';
import { SessionStore } from '../../src/session/store.js';

async function fixture(
  admins: string[] = [],
  allowedUsers: string[] = [],
  allowedChats: string[] = [],
) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-lark-session-command-'));
  const store = new SessionProjectionStore(join(root, 'projection.json'));
  const sessions = new SessionStore(join(root, 'sessions.json'));
  const scopes = new ScopeDirectory(join(root, 'scopes.json'));
  await Promise.all([store.load(), sessions.load(), scopes.load()]);
  const session = { sessionId: 's1', updatedAt: 100, running: false, blank: false, cwd: '/repo', title: 'Release' };
  const prepared = { session, messages: [{ role: 'user' as const, content: 'secret history', source: 'other-dsh-client' as const }], backfillCount: 1, truncated: false, snapshotSeq: 5 };
  const bridge = {
    eligibleSessions: vi.fn(async () => [session]),
    prepare: vi.fn(async () => prepared),
    bindConfirmed: vi.fn(async (input: Parameters<SessionProjectionBridge['bindConfirmed']>[0]) => {
      const result = await store.bindExclusive({
        scope: input.scope,
        workspaceCwd: input.workspaceCwd,
        sessionId: input.prepared.session.sessionId,
        chatId: input.chatId,
        ...(input.threadId ? { threadId: input.threadId } : {}),
        initialSeq: input.prepared.snapshotSeq,
        ...(input.allowCrossScopeMigration ? { allowCrossScopeMigration: true } : {}),
        ...(input.expectedOwner ? { expectedOwner: input.expectedOwner } : {}),
      });
      input.onBindingCommitted?.(result);
      return { ...result, transcriptDelivered: true };
    }),
  } as unknown as SessionProjectionBridge;
  const sendCard = vi.fn(async (_chatId: string, _card: object) => 'card');
  const sendMarkdown = vi.fn(async () => undefined);
  const access = {
    isAdmin: (id: string | undefined) => !!id && admins.includes(id),
    snapshot: () => ({ admins: [...admins], allowedUsers: [...allowedUsers], allowedChats: [...allowedChats] }),
  } as AccessManager;
  const controller = new SessionProjectionController({
    bridge, store, sessions, scopes, access,
    channel: { sendCard, sendMarkdown },
  });
  return { controller, bridge, store, sessions, scopes, sendCard, sendMarkdown, prepared };
}

function commandContext(input: {
  controller: SessionProjectionController;
  scope: string;
  chatId: string;
  chatMode: 'p2p' | 'group' | 'topic';
  senderId: string;
}) {
  return {
    scope: input.scope,
    chatId: input.chatId,
    chatMode: input.chatMode,
    senderId: input.senderId,
    threadId: input.chatMode === 'topic' ? 'thread-a' : undefined,
    defaultWorkspace: '/repo',
    workspaces: { cwdFor: () => '/repo' },
    channel: (input.controller as unknown as { deps: { channel: unknown } }).deps.channel,
    sessionProjection: input.controller,
  } as unknown as CommandContext;
}

describe('/session explicit binding workflow', () => {
  it('shows metadata-only selector in p2p and sends no history before confirmation', async () => {
    const f = await fixture();
    f.scopes.register('chat-a', 'chat-a', undefined, 'p2p', 'incoming');
    await f.controller.handleCommand('', commandContext({
      controller: f.controller, scope: 'chat-a', chatId: 'chat-a', chatMode: 'p2p', senderId: 'user-a',
    }));
    const selector = JSON.stringify(f.sendCard.mock.calls[0]?.[1]);
    expect(selector).toContain('Release');
    expect(selector).toContain('s1');
    expect(selector).not.toContain('secret history');
    expect(f.bridge.bindConfirmed).not.toHaveBeenCalled();
  });

  it('requires profile admin for group/topic but permits the owner of a member scope', async () => {
    const f = await fixture();
    await expect(f.controller.handleCommand('', commandContext({
      controller: f.controller, scope: 'chat-g', chatId: 'chat-g', chatMode: 'group', senderId: 'member-a',
    }))).rejects.toThrow('仅管理员');
    f.scopes.register('chat-g:member:member-a', 'chat-g', undefined, 'group', 'incoming');
    await expect(f.controller.handleCommand('', commandContext({
      controller: f.controller, scope: 'chat-g:member:member-a', chatId: 'chat-g', chatMode: 'group', senderId: 'member-a',
    }))).resolves.toBeUndefined();
    await expect(f.controller.handleCommand('', commandContext({
      controller: f.controller, scope: 'chat-g:member:member-a', chatId: 'chat-g', chatMode: 'group', senderId: 'member-b',
    }))).rejects.toThrow('本人');
  });

  it('freezes actor/scope/workspace in a one-shot confirmation and binds only after confirm', async () => {
    const f = await fixture(['admin-a']);
    f.scopes.register('chat-g:thread-a', 'chat-g', 'thread-a', 'topic', 'incoming');
    const selected = await f.controller.handleAction({
      value: {
        cmd: 'session-projection', action: 'select', sessionId: 's1',
        scope: 'chat-g:thread-a', workspaceCwd: '/repo', actorId: 'admin-a',
      },
      operatorId: 'admin-a', chatId: 'chat-g', threadId: 'thread-a', currentScope: 'chat-g:thread-a',
    });
    expect(selected.toast.type).toBe('info');
    expect(f.bridge.bindConfirmed).not.toHaveBeenCalled();
    const confirmation = f.sendCard.mock.calls[0]?.[1];
    const serialized = JSON.stringify(confirmation);
    expect(serialized).not.toContain('secret history');
    expect(serialized).toContain('即将回填');
    const nonce = [...serialized.matchAll(/"nonce":"([^"]+)"/g)][0]?.[1];
    expect(nonce).toBeTruthy();

    const wrongActor = await f.controller.handleAction({
      value: { cmd: 'session-projection', action: 'confirm', nonce, scope: 'chat-g:thread-a', workspaceCwd: '/repo', actorId: 'admin-a' },
      operatorId: 'admin-b', chatId: 'chat-g', threadId: 'thread-a', currentScope: 'chat-g:thread-a',
    });
    expect(wrongActor.toast.type).toBe('error');
    expect(f.bridge.bindConfirmed).not.toHaveBeenCalled();

    const confirmed = await f.controller.handleAction({
      value: { cmd: 'session-projection', action: 'confirm', nonce, scope: 'chat-g:thread-a', workspaceCwd: '/repo', actorId: 'admin-a' },
      operatorId: 'admin-a', chatId: 'chat-g', threadId: 'thread-a', currentScope: 'chat-g:thread-a',
    });
    expect(confirmed.toast.type).toBe('success');
    expect(f.bridge.bindConfirmed).toHaveBeenCalledOnce();
    expect(f.sessions.resumeFor('chat-g:thread-a', '/repo')).toBe('s1');

    const replayed = await f.controller.handleAction({
      value: { cmd: 'session-projection', action: 'confirm', nonce, scope: 'chat-g:thread-a', workspaceCwd: '/repo', actorId: 'admin-a' },
      operatorId: 'admin-a', chatId: 'chat-g', threadId: 'thread-a', currentScope: 'chat-g:thread-a',
    });
    expect(replayed.toast.type).toBe('error');
    expect(f.bridge.bindConfirmed).toHaveBeenCalledOnce();
  });

  it('does not let an ordinary p2p user migrate another scope exclusive binding', async () => {
    const f = await fixture();
    await f.store.bindExclusive({
      scope: 'chat-old', workspaceCwd: '/repo', sessionId: 's1', chatId: 'chat-old', initialSeq: 5,
    });
    f.scopes.register('chat-new', 'chat-new', undefined, 'p2p', 'incoming');
    await expect(f.controller.handleCommand('bind s1', commandContext({
      controller: f.controller, scope: 'chat-new', chatId: 'chat-new', chatMode: 'p2p', senderId: 'user-new',
    }))).rejects.toThrow('仅 profile 管理员');
    expect(f.bridge.prepare).not.toHaveBeenCalled();
    expect(f.store.ownerOf('s1')?.scope).toBe('chat-old');
  });

  it('rechecks current user/chat allowlists for commands and stale card actions', async () => {
    const f = await fixture(['admin-a'], ['admin-a'], ['chat-allowed']);
    await expect(f.controller.handleCommand('', commandContext({
      controller: f.controller, scope: 'chat-private', chatId: 'chat-private', chatMode: 'p2p', senderId: 'revoked-user',
    }))).rejects.toThrow('用户白名单');

    f.scopes.register('chat-blocked:thread-a', 'chat-blocked', 'thread-a', 'topic', 'incoming');
    const blocked = await f.controller.handleAction({
      value: {
        cmd: 'session-projection', action: 'select', sessionId: 's1',
        scope: 'chat-blocked:thread-a', workspaceCwd: '/repo', actorId: 'admin-a',
      },
      operatorId: 'admin-a', chatId: 'chat-blocked', threadId: 'thread-a', currentScope: 'chat-blocked:thread-a',
    });
    expect(blocked.toast).toEqual(expect.objectContaining({ type: 'error', content: expect.stringContaining('群聊白名单') }));
    expect(f.bridge.prepare).not.toHaveBeenCalled();
  });

  it('rejects a stale disclosure and clears the displaced SessionStore mapping after admin migration', async () => {
    const stale = await fixture();
    stale.scopes.register('chat-new', 'chat-new', undefined, 'p2p', 'incoming');
    await stale.controller.handleCommand('bind s1', commandContext({
      controller: stale.controller, scope: 'chat-new', chatId: 'chat-new', chatMode: 'p2p', senderId: 'user-new',
    }));
    const staleCard = JSON.stringify(stale.sendCard.mock.calls[0]?.[1]);
    const staleNonce = [...staleCard.matchAll(/"nonce":"([^"]+)"/g)][0]?.[1];
    await stale.store.bindExclusive({
      scope: 'chat-old', workspaceCwd: '/repo', sessionId: 's1', chatId: 'chat-old', initialSeq: 5,
    });
    const staleResult = await stale.controller.handleAction({
      value: { cmd: 'session-projection', action: 'confirm', nonce: staleNonce, scope: 'chat-new', workspaceCwd: '/repo', actorId: 'user-new' },
      operatorId: 'user-new', chatId: 'chat-new', threadId: undefined, currentScope: 'chat-new',
    });
    expect(staleResult.toast.type).toBe('error');
    expect(stale.store.ownerOf('s1')?.scope).toBe('chat-old');

    const admin = await fixture(['admin-a']);
    admin.scopes.register('chat-new', 'chat-new', undefined, 'p2p', 'incoming');
    await admin.store.bindExclusive({
      scope: 'chat-old', workspaceCwd: '/repo', sessionId: 's1', chatId: 'chat-old', initialSeq: 5,
    });
    admin.sessions.set('chat-old', 's1', '/repo');
    await admin.sessions.flush();
    await admin.controller.handleCommand('bind s1', commandContext({
      controller: admin.controller, scope: 'chat-new', chatId: 'chat-new', chatMode: 'p2p', senderId: 'admin-a',
    }));
    const adminCard = JSON.stringify(admin.sendCard.mock.calls[0]?.[1]);
    const adminNonce = [...adminCard.matchAll(/"nonce":"([^"]+)"/g)][0]?.[1];
    const migrated = await admin.controller.handleAction({
      value: { cmd: 'session-projection', action: 'confirm', nonce: adminNonce, scope: 'chat-new', workspaceCwd: '/repo', actorId: 'admin-a' },
      operatorId: 'admin-a', chatId: 'chat-new', threadId: undefined, currentScope: 'chat-new',
    });
    expect(migrated.toast.type).toBe('success');
    expect(admin.sessions.resumeFor('chat-old', '/repo')).toBeUndefined();
    expect(admin.sessions.resumeFor('chat-new', '/repo')).toBe('s1');
  });
});
