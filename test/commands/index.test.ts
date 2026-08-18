import { describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ActiveRuns } from '../../src/bot/active-runs.js';
import { ConcurrencyStore } from '../../src/bot/concurrency-store.js';
import { ModelStore } from '../../src/bot/model-store.js';
import { WizardStore } from '../../src/bot/wizard-store.js';
import { RetentionStore } from '../../src/bot/retention-store.js';
import { RoleStore } from '../../src/bot/role-store.js';
import { ScopeDirectory } from '../../src/bridge/scope-directory.js';
import { RunPolicyStore } from '../../src/bot/run-policy.js';
import { AccessManager } from '../../src/config/access-manager.js';
import { DshProviderManager } from '../../src/config/dsh-config.js';
import { ConfigStore } from '../../src/config/profile-store.js';
import {
  tryHandleCommand,
  type CommandChannel,
  type CommandContext,
} from '../../src/commands/index.js';
import { SessionStore } from '../../src/session/store.js';
import type { SessionArchive } from '../../src/session/archive.js';
import { WorkspaceStore } from '../../src/workspace/store.js';
import { latestVersion } from '../../src/upgrade/update-check.js';

vi.mock('../../src/upgrade/update-check.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/upgrade/update-check.js')>();
  return {
    ...actual,
    // Pin both versions so the assertions are independent of the package
    // version at release time (CI checks out the tag, where current == latest).
    currentVersion: () => '0.13.1',
    latestVersion: vi.fn().mockResolvedValue('0.14.0'),
  };
});

function makeArchiver(): SessionArchive {
  return {
    archive: vi.fn().mockResolvedValue({
      archiveId: 'archive-1',
      scope: 'chat-a',
      cwd: '/tmp/default',
      source: 'manual',
      note: undefined,
      messageCount: 0,
      archivedAt: new Date().toISOString(),
      jsonlPath: '/tmp/a.jsonl',
      markdownPath: '/tmp/a.md',
      gitCommit: undefined,
    }),
    list: vi.fn().mockResolvedValue([]),
    prune: vi.fn().mockResolvedValue(0),
  } as unknown as SessionArchive;
}

function makeAccessManager(initial: {
  allowedUsers?: string[];
  allowedChats?: string[];
  admins?: string[];
} = {}): AccessManager {
  const state = {
    allowedUsers: [...(initial.allowedUsers ?? [])],
    allowedChats: [...(initial.allowedChats ?? [])],
    admins: [...(initial.admins ?? [])],
  };
  return {
    snapshot: () => ({
      allowedUsers: [...state.allowedUsers],
      allowedChats: [...state.allowedChats],
      admins: [...state.admins],
    }),
    addUser: vi.fn(async (id: string) => {
      state.allowedUsers.push(id);
    }),
    addAdmin: vi.fn(async (id: string) => {
      state.admins.push(id);
    }),
    addChat: vi.fn(async (id: string) => {
      state.allowedChats.push(id);
    }),
    removeUser: vi.fn(async (id: string) => {
      state.allowedUsers = state.allowedUsers.filter((item) => item !== id);
    }),
    removeChat: vi.fn(async (id: string) => {
      state.allowedChats = state.allowedChats.filter((item) => item !== id);
    }),
    isAdmin: (id: string | undefined) => Boolean(id && state.admins.includes(id)),
  } as unknown as AccessManager;
}

function makeContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    scope: 'chat-a',
    chatId: 'chat-a',
    messageId: 'msg-1',
    threadId: undefined,
    chatMode: 'p2p',
    sessions: new SessionStore(':memory:'),
    workspaces: new WorkspaceStore(':memory:'),
    activeRuns: new ActiveRuns(),
    runPolicies: new RunPolicyStore(),
    concurrencyStore: new ConcurrencyStore(),
    defaultScopeConcurrency: 2,
    retentionStore: new RetentionStore(),
    roleStore: new RoleStore(':memory:'),
    isolationStore: { get: () => 'topic', set: () => {} },
    isolationMode: 'topic',
    scopeDirectory: new ScopeDirectory(':memory:'),
    archiver: makeArchiver(),
    defaultRetention: 40,
    archiveMax: 50,
    archiveMaxAgeDays: 90,
    approvals: undefined,
    questions: undefined,
    densityStore: undefined,
    models: new ModelStore(),
    wizardStore: new WizardStore(),
    dshConfig: new DshProviderManager({
      home: join(tmpdir(), 'dsh-lark-bot-test-home'),
    }),
    defaultRunTimeoutMs: 300_000,
    defaultModel: 'deepseek-v4-flash',
    senderId: undefined,
    accessManager: new AccessManager(
      new ConfigStore(':memory:'),
      'default',
    ),
    channel: {
      sendMarkdown: vi.fn().mockResolvedValue(undefined),
    } as unknown as CommandChannel,
    defaultWorkspace: '/tmp/default',
    ...overrides,
  };
}

describe('command router', () => {
  it('routes /cd and updates the workspace', async () => {
    const ctx = makeContext();
    const handled = await tryHandleCommand('/cd /tmp/project', ctx);

    expect(handled).toBe(true);
    expect(ctx.workspaces.cwdFor('chat-a')).toBe('/tmp/project');
    expect(ctx.channel.sendMarkdown).toHaveBeenCalled();
  });

  it('leaves non-command text untouched', async () => {
    const ctx = makeContext();
    await expect(tryHandleCommand('fix the bug', ctx)).resolves.toBe(false);
    expect(ctx.channel.sendMarkdown).not.toHaveBeenCalled();
  });

  it('reads and updates the per-scope run timeout policy', async () => {
    const ctx = makeContext();

    await tryHandleCommand('/timeout 12', ctx);
    expect(ctx.runPolicies.get('chat-a')).toBe(12 * 60_000);

    await tryHandleCommand('/timeout off', ctx);
    expect(ctx.runPolicies.get('chat-a')).toBe(0);

    await tryHandleCommand('/timeout default', ctx);
    expect(ctx.runPolicies.get('chat-a')).toBeUndefined();
  });

  it('lets only admins change group isolation while preserving existing scopes', async () => {
    let mode: 'group' | 'topic' | 'member' = 'topic';
    const set = vi.fn((_chatId: string, next: typeof mode) => { mode = next; });
    const isolationStore = { get: () => mode, set };
    const accessManager = makeAccessManager({ admins: ['ou_owner'] });
    const sessions = new SessionStore(':memory:');
    sessions.recordExchange('chat-a', '/tmp/default', ['old'], 'group history');
    sessions.recordExchange('chat-a:thread-1', '/tmp/default', ['old'], 'topic history');
    const ctx = makeContext({
      chatMode: 'group',
      senderId: 'ou_guest',
      accessManager,
      sessions,
      isolationStore,
      isolationMode: 'topic',
    });

    await tryHandleCommand('/isolation member', ctx);
    expect(set).not.toHaveBeenCalled();

    ctx.senderId = 'ou_owner';
    await tryHandleCommand('/isolation member', ctx);
    expect(set).toHaveBeenCalledWith('chat-a', 'member');
    expect(mode).toBe('member');
    expect(sessions.historyFor('chat-a', '/tmp/default')).toHaveLength(2);
    expect(sessions.historyFor('chat-a:thread-1', '/tmp/default')).toHaveLength(2);
  });

  it('/stop reaches the actor scopes created before an isolation switch', async () => {
    const activeRuns = new ActiveRuns();
    const interrupt = vi.spyOn(activeRuns, 'interrupt').mockImplementation(async (scope) =>
      scope === 'chat-a:member:ou_actor' ? 1 : 0,
    );
    const ctx = makeContext({
      activeRuns,
      chatMode: 'topic',
      threadId: 'thread-1',
      senderId: 'ou_actor',
      scope: 'chat-a',
      isolationMode: 'group',
    });

    await tryHandleCommand('/stop', ctx);

    expect(interrupt.mock.calls.map(([scope]) => scope)).toEqual([
      'chat-a',
      'chat-a:thread-1',
      'chat-a:member:ou_actor',
    ]);
    expect(ctx.channel.sendMarkdown).toHaveBeenCalledWith(
      'chat-a',
      expect.stringContaining('全部 1 个任务'),
      { replyTo: 'msg-1' },
    );
  });

  it('shows recent conversation context for /resume', async () => {
    const ctx = makeContext();
    ctx.sessions.recordExchange('chat-a', '/tmp/default', ['hello'], 'hi!');

    await tryHandleCommand('/resume', ctx);

    expect(ctx.channel.sendMarkdown).toHaveBeenCalledWith(
      'chat-a',
      expect.stringContaining('👤 hello'),
      { replyTo: 'msg-1' },
    );
  });

  it('lists the current access allowlist', async () => {
    const ctx = makeContext({
      accessManager: {
        snapshot: () => ({
          allowedUsers: ['ou_owner'],
          allowedChats: ['oc_room'],
          admins: ['ou_owner'],
        }),
      } as unknown as AccessManager,
    });

    await tryHandleCommand('/invite list', ctx);

    expect(ctx.channel.sendMarkdown).toHaveBeenCalledWith(
      'chat-a',
      expect.stringContaining('ou_owner'),
      { replyTo: 'msg-1' },
    );
  });

  it('rejects non-admin /invite mutating commands (self-escalation guard)', async () => {
    const accessManager = makeAccessManager();
    const ctx = makeContext({ senderId: 'ou_stranger', accessManager });
    const snapshot = () => ctx.accessManager.snapshot();

    await tryHandleCommand('/invite admin ou_stranger', ctx);
    expect(snapshot().admins).not.toContain('ou_stranger');

    await tryHandleCommand('/invite user ou_friend', ctx);
    expect(snapshot().allowedUsers).not.toContain('ou_friend');

    await tryHandleCommand('/invite group oc_room', ctx);
    expect(snapshot().allowedChats).not.toContain('oc_room');

    await tryHandleCommand('/invite remove user ou_friend', ctx);
    expect(snapshot().allowedUsers).not.toContain('ou_friend');

    // Every rejection replies with the admin-only message instead of mutating.
    expect(ctx.channel.sendMarkdown).toHaveBeenCalledWith(
      'chat-a',
      expect.stringContaining('仅管理员可执行该操作'),
      { replyTo: 'msg-1' },
    );
  });

  it('keeps /invite list open for non-admins (read-only)', async () => {
    const ctx = makeContext({
      senderId: 'ou_stranger',
      accessManager: makeAccessManager(),
    });

    await tryHandleCommand('/invite list', ctx);

    expect(ctx.channel.sendMarkdown).toHaveBeenCalledWith(
      'chat-a',
      expect.stringContaining('访问白名单'),
      { replyTo: 'msg-1' },
    );
  });

  it('lets an admin add another admin via /invite admin', async () => {
    const ctx = makeContext({
      senderId: 'ou_owner',
      accessManager: makeAccessManager({ admins: ['ou_owner'] }),
    });

    await tryHandleCommand('/invite admin ou_new_admin', ctx);

    expect(ctx.accessManager.snapshot().admins).toContain('ou_owner');
    expect(ctx.accessManager.snapshot().admins).toContain('ou_new_admin');
  });

  it('answers /help with the command index including the model/provider commands', async () => {
    const ctx = makeContext();

    const handled = await tryHandleCommand('/help', ctx);

    expect(handled).toBe(true);
    const call = (ctx.channel.sendMarkdown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(call?.[0]).toBe('chat-a');
    const body = call?.[1] as string;
    expect(body).toContain('/model');
    expect(body).toContain('/providers');
    expect(body).toContain('/provider');
    expect(body).toContain('/key');
    expect(body).toContain('/help');
    expect(body).toContain('/newg');
  });

  it('/newg creates a group, invites the sender and replies with a link', async () => {
    const createChat = vi.fn().mockResolvedValue({ chatId: 'oc_new_group' });
    const ctx = makeContext({
      senderId: 'ou_sender',
      channel: {
        sendMarkdown: vi.fn().mockResolvedValue(undefined),
        createChat,
      } as unknown as CommandChannel,
    });

    const handled = await tryHandleCommand('/newg 项目A', ctx);

    expect(handled).toBe(true);
    expect(createChat).toHaveBeenCalledWith({
      name: '项目A',
      chatType: 'private',
      chatMode: 'group',
      inviteUserIds: ['ou_sender'],
      userIdType: 'open_id',
    });
    const body = (ctx.channel.sendMarkdown as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1] as string;
    expect(body).toContain('项目A');
    expect(body).toContain('oc_new_group');
    expect(body).toContain('applink.feishu.cn/client/chat/open?chatId=oc_new_group');
  });

  it('/newg without a name prints usage', async () => {
    const ctx = makeContext();
    await tryHandleCommand('/newg', ctx);

    const body = (ctx.channel.sendMarkdown as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1] as string;
    expect(body).toContain('用法');
    expect(ctx.channel.createChat).toBeUndefined();
  });

  it('/newg reports missing channel support', async () => {
    const ctx = makeContext({ senderId: 'ou_sender' });
    await tryHandleCommand('/newg 项目A', ctx);

    const body = (ctx.channel.sendMarkdown as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1] as string;
    expect(body).toContain('不支持');
  });

  it('/newg surfaces create failures', async () => {
    const ctx = makeContext({
      senderId: 'ou_sender',
      channel: {
        sendMarkdown: vi.fn().mockResolvedValue(undefined),
        createChat: vi.fn().mockRejectedValue(new Error('scope missing')),
      } as unknown as CommandChannel,
    });

    await tryHandleCommand('/newg 项目A', ctx);

    const body = (ctx.channel.sendMarkdown as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1] as string;
    expect(body).toContain('建群失败');
    expect(body).toContain('scope missing');
  });

  it('/version reports a newer npm version with the upgrade hint', async () => {
    const ctx = makeContext();
    await tryHandleCommand('/version', ctx);
    const body = (ctx.channel.sendMarkdown as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1] as string;
    expect(body).toContain('版本');
    expect(body).toContain('0.14.0');
    expect(body).toContain('dsh-lark-bot upgrade');
  });

  it('/version says already latest when the versions match', async () => {
    vi.mocked(latestVersion).mockResolvedValueOnce('0.13.1');
    const ctx = makeContext();
    await tryHandleCommand('/version', ctx);
    const body = (ctx.channel.sendMarkdown as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1] as string;
    expect(body).toContain('已是最新');
  });
});
