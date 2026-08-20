import { describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ActiveRuns } from '../../src/bot/active-runs.js';
import { ApprovalRegistry } from '../../src/bot/approvals.js';
import { PlanApprovalRegistry } from '../../src/bot/plan-approvals.js';
import { QuestionRegistry } from '../../src/bot/questions.js';
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
  statusCardInputFor,
  tryHandleCommand,
  type CommandChannel,
  type CommandContext,
} from '../../src/commands/index.js';
import { SessionStore } from '../../src/session/store.js';
import type { SessionArchive } from '../../src/session/archive.js';
import { WorkspaceStore } from '../../src/workspace/store.js';
import { latestVersion } from '../../src/upgrade/update-check.js';
import { JobLedger } from '../../src/bot/job-ledger.js';
import type { PermissionPolicyStore } from '../../src/bot/permission-policy-store.js';
import type { NotificationPreference, NotificationPreferenceStore } from '../../src/bot/notification-preference-store.js';
import type { ReplyPolicy, ReplyPolicyStore } from '../../src/bot/reply-policy-store.js';
import { ExecutionModeStore } from '../../src/bot/execution-mode-store.js';

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
  it('lets everyone inspect reply flow control and only admins persist changes', async () => {
    let policy: ReplyPolicy = { mergeWindowMs: 0, maxBatchSize: 1, minIntervalMs: 0, dedupeWindowMs: 0 };
    let configured = false;
    const replyPolicies = {
      get: () => ({ ...policy }), isConfigured: () => configured,
      set: vi.fn(async (_scope: string, value: ReplyPolicy | undefined) => {
        configured = value !== undefined;
        if (value) policy = value;
      }),
    } as unknown as ReplyPolicyStore;
    const sendMarkdown = vi.fn().mockResolvedValue(undefined);
    const regular = makeContext({ replyPolicies, senderId: 'user', channel: { sendMarkdown }, accessManager: makeAccessManager() });
    await tryHandleCommand('/replies set merge=5 batch=3 interval=10 dedupe=60', regular);
    expect(replyPolicies.set).not.toHaveBeenCalled();
    expect(sendMarkdown).toHaveBeenLastCalledWith('chat-a', expect.stringContaining('群主/群管理员'), { replyTo: 'msg-1' });

    const admin = makeContext({ replyPolicies, senderId: 'admin', channel: { sendMarkdown }, accessManager: makeAccessManager({ admins: ['admin'] }) });
    await tryHandleCommand('/replies set merge=5 batch=3 interval=10 dedupe=60', admin);
    expect(replyPolicies.set).toHaveBeenCalledWith('chat-a', { mergeWindowMs: 5_000, maxBatchSize: 3, minIntervalMs: 10_000, dedupeWindowMs: 60_000 });
    await tryHandleCommand('/replies', regular);
    expect(sendMarkdown).toHaveBeenLastCalledWith('chat-a', expect.stringContaining('合并 5 秒'), { replyTo: 'msg-1' });
    await tryHandleCommand('/replies default', admin);
    expect(replyPolicies.set).toHaveBeenLastCalledWith('chat-a', undefined);
  });

  it('lets a current Feishu group administrator change reply flow control', async () => {
    const replyPolicies = {
      get: () => ({ mergeWindowMs: 0, maxBatchSize: 1, minIntervalMs: 0, dedupeWindowMs: 0 }),
      isConfigured: () => false,
      set: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReplyPolicyStore;
    const ctx = makeContext({
      chatMode: 'group',
      senderId: 'ou_group_admin',
      replyPolicies,
      isChatAdministrator: vi.fn().mockResolvedValue(true),
      accessManager: makeAccessManager(),
    });

    await tryHandleCommand('/replies set merge=5', ctx);

    expect(replyPolicies.set).toHaveBeenCalledWith('chat-a', {
      mergeWindowMs: 5_000,
      maxBatchSize: 1,
      minIntervalMs: 0,
      dedupeWindowMs: 0,
    });
  });

  it('fails closed when current-group administrator verification is unavailable', async () => {
    const replyPolicies = {
      get: () => ({ mergeWindowMs: 0, maxBatchSize: 1, minIntervalMs: 0, dedupeWindowMs: 0 }),
      isConfigured: () => false,
      set: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReplyPolicyStore;
    const sendMarkdown = vi.fn().mockResolvedValue(undefined);
    const ctx = makeContext({
      chatMode: 'group',
      senderId: 'ou_unknown',
      replyPolicies,
      isChatAdministrator: vi.fn().mockRejectedValue(new Error('chat lookup unavailable')),
      accessManager: makeAccessManager(),
      channel: { sendMarkdown },
    });

    await tryHandleCommand('/replies set merge=5', ctx);

    expect(replyPolicies.set).not.toHaveBeenCalled();
    expect(sendMarkdown).toHaveBeenCalledWith(
      'chat-a',
      expect.stringContaining('群主/群管理员'),
      { replyTo: 'msg-1' },
    );
  });
  it('persists opt-in notifications and admin-gates cross-session targets', async () => {
    let preference: NotificationPreference | undefined;
    const notificationPreferences = {
      get: () => preference,
      set: vi.fn(async (_scope: string, value: NotificationPreference | undefined) => { preference = value; }),
    } as unknown as NotificationPreferenceStore;
    const sendMarkdown = vi.fn().mockResolvedValue(undefined);
    const regular = makeContext({ notificationPreferences, senderId: 'ou_user', channel: { sendMarkdown }, accessManager: makeAccessManager() });
    await tryHandleCommand('/notifications on current events=completed,approval mentions=self remind=5', regular);
    expect(notificationPreferences.set).toHaveBeenCalledWith('chat-a', { events: ['completed', 'approval'], mentionUserIds: ['ou_user'], approvalReminderMs: 300_000 });
    await tryHandleCommand('/notifications on chat-b', regular);
    expect(sendMarkdown).toHaveBeenLastCalledWith('chat-a', expect.stringContaining('只有管理员'), { replyTo: 'msg-1' });

    const directory = new ScopeDirectory(':memory:');
    directory.register('chat-b', 'chat-b', undefined);
    const admin = makeContext({ notificationPreferences, scopeDirectory: directory, senderId: 'ou_admin', channel: { sendMarkdown }, accessManager: makeAccessManager({ admins: ['ou_admin'] }) });
    await tryHandleCommand('/notifications on chat-b events=failed mentions=none remind=3', admin);
    expect(notificationPreferences.set).toHaveBeenLastCalledWith('chat-a', { target: 'chat-b', events: ['failed'], mentionUserIds: [], approvalReminderMs: 180_000 });
    await tryHandleCommand('/notifications off', admin);
    expect(notificationPreferences.set).toHaveBeenLastCalledWith('chat-a', undefined);
  });

  it('shows permission policy and restricts policy changes to admins', async () => {
    let policy = 'ask' as 'ask' | 'allow' | 'deny';
    const permissionPolicies = {
      get: () => policy,
      set: vi.fn(async (_scope: string, next: typeof policy) => { policy = next; }),
    } as unknown as PermissionPolicyStore;
    const sendMarkdown = vi.fn().mockResolvedValue(undefined);
    const regular = makeContext({ permissionPolicies, senderId: 'user', channel: { sendMarkdown }, accessManager: makeAccessManager() });
    await tryHandleCommand('/permission allow', regular);
    expect(permissionPolicies.set).not.toHaveBeenCalled();
    expect(sendMarkdown).toHaveBeenLastCalledWith('chat-a', expect.stringContaining('仅管理员'), { replyTo: 'msg-1' });

    const admin = makeContext({ permissionPolicies, senderId: 'admin', channel: { sendMarkdown }, accessManager: makeAccessManager({ admins: ['admin'] }) });
    await tryHandleCommand('/permission deny', admin);
    expect(permissionPolicies.set).toHaveBeenCalledWith('chat-a', 'deny');
    await tryHandleCommand('/permission', admin);
    expect(sendMarkdown).toHaveBeenLastCalledWith('chat-a', expect.stringContaining('deny'), { replyTo: 'msg-1' });

    await tryHandleCommand('/permission allow chat-a:member:user', admin);
    expect(permissionPolicies.set).toHaveBeenLastCalledWith('chat-a:member:user', 'allow');
    await tryHandleCommand('/permission deny other-chat:member:user', admin);
    expect(permissionPolicies.set).not.toHaveBeenCalledWith('other-chat:member:user', 'deny');
    expect(sendMarkdown).toHaveBeenLastCalledWith('chat-a', expect.stringContaining('只能修改当前聊天'), { replyTo: 'msg-1' });
  });

  it('does not report a permission change as successful when persistence fails', async () => {
    const sendMarkdown = vi.fn().mockResolvedValue(undefined);
    const ctx = makeContext({
      senderId: 'admin',
      accessManager: makeAccessManager({ admins: ['admin'] }),
      permissionPolicies: {
        get: () => 'ask',
        set: vi.fn().mockRejectedValue(new Error('disk full')),
      } as unknown as PermissionPolicyStore,
      channel: { sendMarkdown },
    });
    await expect(tryHandleCommand('/permission deny', ctx)).rejects.toThrow('disk full');
    expect(sendMarkdown).not.toHaveBeenCalledWith('chat-a', expect.stringContaining('已将 scope'), expect.anything());
  });

  it('sends /status as a refreshable card with current scope metrics', async () => {
    const sessions = new SessionStore(':memory:');
    sessions.set('chat-a', 'session-1', '/tmp/default');
    sessions.recordUsage('chat-a', '/tmp/default', { inputTokens: 10, outputTokens: 4 });
    sessions.recordContextUsage('chat-a', '/tmp/default', {
      usedTokens: 32,
      contextWindow: 128,
      sessionId: 'session-1',
      model: 'deepseek-official/deepseek-v4-flash',
    });
    const activeRuns = new ActiveRuns();
    activeRuns.set('chat-a', { runId: 'run-1', workspaceCwd: '/tmp/default', stop: vi.fn() });
    const approvals = new ApprovalRegistry();
    void approvals.register('chat-a', {
      id: 'approval-1',
      sessionId: 'session-1',
      toolName: 'bash',
      reason: undefined,
      options: [],
    });
    const questions = new QuestionRegistry();
    void questions.register('chat-a', { question: 'Continue?', kind: 'text' }, 'session-1');
    const plans = new PlanApprovalRegistry();
    void plans.register('chat-a', 'session-1');
    const sendCard = vi.fn().mockResolvedValue('status-message');
    const ctx = makeContext({
      sessions,
      activeRuns,
      approvals,
      questions,
      plans,
      channel: {
        sendMarkdown: vi.fn().mockResolvedValue(undefined),
        sendCard,
      },
    });

    await tryHandleCommand('/status', ctx);

    expect(sendCard).toHaveBeenCalledWith(
      'chat-a',
      expect.objectContaining({ schema: '2.0' }),
      { replyTo: 'msg-1' },
    );
    const json = JSON.stringify(sendCard.mock.calls[0]?.[1]);
    expect(json).toContain('32 / 128（25.0%）');
    expect(json).toContain('审批 `1` · 提问 `1` · 计划 `1`');
    expect(json).toContain('run-1');
  });

  it('falls back to the same status content when card delivery is rejected', async () => {
    const sendMarkdown = vi.fn().mockResolvedValue(undefined);
    const ctx = makeContext({
      channel: {
        sendMarkdown,
        sendCard: vi.fn().mockRejectedValue(new Error('card unsupported')),
      },
    });

    await tryHandleCommand('/status', ctx);

    expect(sendMarkdown).toHaveBeenCalledWith(
      'chat-a',
      expect.stringContaining('会话状态'),
      { replyTo: 'msg-1' },
    );
  });

  it('shows a configured model context limit without guessing used tokens', async () => {
    const sendCard = vi.fn().mockResolvedValue('status-message');
    const ctx = makeContext({
      dshConfig: {
        resolveModelRoute: vi.fn().mockResolvedValue({ provider: 'gateway', model: 'm' }),
        listProviders: vi.fn().mockResolvedValue([{
          id: 'gateway',
          displayName: 'Gateway',
          namespace: 'pi-ai',
          configured: true,
          credentialRef: 'KEY',
          credentialReady: true,
          managed: true,
          models: [{ id: 'm', name: 'M', contextWindow: 65_536, maxTokens: 4_096 }],
        }]),
      } as unknown as DshProviderManager,
      defaultModel: 'gateway/m',
      channel: {
        sendMarkdown: vi.fn().mockResolvedValue(undefined),
        sendCard,
      },
    });

    await tryHandleCommand('/status', ctx);

    expect(JSON.stringify(sendCard.mock.calls[0]?.[1])).toContain(
      '暂无 / 65,536（暂无）',
    );
  });

  it('does not reuse a context snapshot after the effective model changes', async () => {
    const sessions = new SessionStore(':memory:');
    sessions.set('chat-a', 'session-1', '/tmp/default');
    sessions.recordContextUsage('chat-a', '/tmp/default', {
      usedTokens: 32,
      contextWindow: 128,
      sessionId: 'session-1',
      model: 'gateway/old-model',
    });
    const sendCard = vi.fn().mockResolvedValue('status-message');
    const ctx = makeContext({
      sessions,
      defaultModel: 'gateway/new-model',
      channel: {
        sendMarkdown: vi.fn().mockResolvedValue(undefined),
        sendCard,
      },
    });

    await tryHandleCommand('/status', ctx);

    const json = JSON.stringify(sendCard.mock.calls[0]?.[1]);
    expect(json).toContain('**model**：`gateway/new-model`');
    expect(json).toContain('**上下文**：暂无 / 暂无（暂无）');
    expect(json).not.toContain('32 / 128');
  });

  it('matches a bare effective model to its canonical provider route', async () => {
    const sessions = new SessionStore(':memory:');
    sessions.set('chat-a', 'session-1', '/tmp/default');
    sessions.recordContextUsage('chat-a', '/tmp/default', {
      usedTokens: 48,
      contextWindow: 256,
      sessionId: 'session-1',
      model: 'gateway/model-a',
    });
    const sendCard = vi.fn().mockResolvedValue('status-message');
    const ctx = makeContext({
      sessions,
      defaultModel: 'model-a',
      dshConfig: {
        resolveModelRoute: vi.fn().mockResolvedValue({ provider: 'gateway', model: 'model-a' }),
        listProviders: vi.fn(),
      } as unknown as DshProviderManager,
      channel: {
        sendMarkdown: vi.fn().mockResolvedValue(undefined),
        sendCard,
      },
    });

    await tryHandleCommand('/status', ctx);

    const json = JSON.stringify(sendCard.mock.calls[0]?.[1]);
    expect(json).toContain('**model**：`model-a`');
    expect(json).toContain('48 / 256（18.8%）');
  });

  it('switches /cd by interrupting the old workspace run without clearing its session', async () => {
    const ctx = makeContext();
    ctx.sessions.set('chat-a', 'session-a', '/tmp/default');
    ctx.sessions.recordExchange('chat-a', '/tmp/default', ['context a'], 'answer a');
    const stop = vi.fn();
    ctx.activeRuns.set('chat-a', { runId: 'run-a', workspaceCwd: '/tmp/default', stop });
    const handled = await tryHandleCommand('/cd /tmp/project', ctx);

    expect(handled).toBe(true);
    expect(ctx.workspaces.cwdFor('chat-a')).toBe('/tmp/project');
    expect(ctx.sessions.resumeFor('chat-a', '/tmp/default')).toBe('session-a');
    expect(ctx.sessions.historyFor('chat-a', '/tmp/default')).toHaveLength(2);
    expect(stop).toHaveBeenCalledOnce();
    expect(ctx.channel.sendMarkdown).toHaveBeenCalled();
  });

  it('/new clears only the currently selected workspace session', async () => {
    const ctx = makeContext();
    ctx.sessions.set('chat-a', 'session-a', '/tmp/default');
    ctx.sessions.set('chat-a', 'session-b', '/tmp/project-b');
    ctx.workspaces.setCwd('chat-a', '/tmp/project-b');

    await tryHandleCommand('/new', ctx);

    expect(ctx.sessions.resumeFor('chat-a', '/tmp/project-b')).toBeUndefined();
    expect(ctx.sessions.resumeFor('chat-a', '/tmp/default')).toBe('session-a');
  });

  it('/ws use stops the old workspace run and restores the named workspace session', async () => {
    const ctx = makeContext();
    ctx.workspaces.saveNamed('project-a', '/tmp/project-a');
    ctx.workspaces.setCwd('chat-a', '/tmp/project-b');
    ctx.sessions.set('chat-a', 'session-a', '/tmp/project-a');
    const stopB = vi.fn().mockResolvedValue(undefined);
    ctx.activeRuns.set('chat-a', {
      runId: 'run-b', workspaceCwd: '/tmp/project-b', stop: stopB,
    });

    await tryHandleCommand('/ws use project-a', ctx);

    expect(ctx.workspaces.cwdFor('chat-a')).toBe('/tmp/project-a');
    expect(ctx.sessions.resumeFor('chat-a', '/tmp/project-a')).toBe('session-a');
    expect(stopB).toHaveBeenCalledOnce();
  });

  it('/status counts pending interactions only for the current workspace owners', async () => {
    const approvals = new ApprovalRegistry();
    const questions = new QuestionRegistry();
    const plans = new PlanApprovalRegistry();
    const sessions = new SessionStore(':memory:');
    sessions.set('chat-a', 'session-a', '/tmp/default');
    const approvalA = approvals.register('chat-a', {
      id: 'approval-a', sessionId: 'session-a', toolName: 'terminal', reason: undefined, options: [],
    }, 'session-a');
    void approvalA;
    approvals.register('chat-a', {
      id: 'approval-b', sessionId: 'session-b', toolName: 'terminal', reason: undefined, options: [],
    }, 'session-b');
    questions.register('chat-a', { kind: 'text', question: 'A?' }, 'session-a');
    questions.register('chat-a', { kind: 'text', question: 'B?' }, 'session-b');
    plans.register('chat-a', 'session-a');
    plans.register('chat-a', 'session-b');
    const input = await statusCardInputFor(makeContext({ sessions, approvals, questions, plans }));

    expect(input.pending).toEqual({ approvals: 1, questions: 1, plans: 1 });
  });

  it('/ask records its answer in the workspace captured before a later switch', async () => {
    const questions = new QuestionRegistry();
    const sessions = new SessionStore(':memory:');
    const workspaces = new WorkspaceStore(':memory:');
    const sendCard = vi.fn().mockResolvedValue('question-card');
    const ctx = makeContext({
      questions,
      sessions,
      workspaces,
      channel: {
        sendMarkdown: vi.fn().mockResolvedValue(undefined),
        sendCard,
      },
    });

    const command = tryHandleCommand('/ask Why?', ctx);
    await vi.waitFor(() => expect(questions.pendingForMessage('question-card')).toBeDefined());
    workspaces.setCwd('chat-a', '/tmp/project-b');
    const pending = questions.pendingForMessage('question-card')!;
    questions.resolve('chat-a', pending.id, 'Because');
    await command;

    expect(sessions.historyFor('chat-a', '/tmp/default')).toEqual([
      { role: 'user', content: 'Because' },
    ]);
    expect(sessions.historyFor('chat-a', '/tmp/project-b')).toEqual([]);
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

  it('lets an admin generate and download a diagnostic bundle in the original thread', async () => {
    const sendFile = vi.fn().mockResolvedValue(undefined);
    const createDiagnosticBundle = vi.fn().mockResolvedValue({
      fileName: 'dsh-lark-diagnostic-20260820.md',
      content: Buffer.from('# diagnostic'),
    });
    const ctx = makeContext({
      senderId: 'ou_owner',
      threadId: 'thread-a',
      accessManager: makeAccessManager({ admins: ['ou_owner'] }),
      createDiagnosticBundle,
      channel: {
        sendMarkdown: vi.fn().mockResolvedValue(undefined),
        sendFile,
      },
    });

    await expect(tryHandleCommand('/doctor', ctx)).resolves.toBe(true);

    expect(createDiagnosticBundle).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'chat-a',
      chatMode: 'p2p',
      workspace: '/tmp/default',
    }));
    expect(sendFile).toHaveBeenCalledWith(
      'chat-a',
      'dsh-lark-diagnostic-20260820.md',
      expect.any(Buffer),
      { replyTo: 'msg-1', threadId: 'thread-a' },
    );
  });

  it('rejects diagnostic export for non-admins before reading logs', async () => {
    const createDiagnosticBundle = vi.fn();
    const sendFile = vi.fn();
    const ctx = makeContext({
      senderId: 'ou_guest',
      accessManager: makeAccessManager({ admins: ['ou_owner'] }),
      createDiagnosticBundle,
      channel: { sendMarkdown: vi.fn().mockResolvedValue(undefined), sendFile },
    });

    await tryHandleCommand('/doctor', ctx);

    expect(createDiagnosticBundle).not.toHaveBeenCalled();
    expect(sendFile).not.toHaveBeenCalled();
    expect(ctx.channel.sendMarkdown).toHaveBeenCalledWith(
      'chat-a',
      expect.stringContaining('仅管理员'),
      { replyTo: 'msg-1' },
    );
  });

  it('reports diagnostic upload failures instead of claiming success', async () => {
    const ctx = makeContext({
      senderId: 'ou_owner',
      accessManager: makeAccessManager({ admins: ['ou_owner'] }),
      createDiagnosticBundle: vi.fn().mockResolvedValue({
        fileName: 'diagnostic.md',
        content: Buffer.from('safe'),
      }),
      channel: {
        sendMarkdown: vi.fn().mockResolvedValue(undefined),
        sendFile: vi.fn().mockRejectedValue(new Error('upload unavailable')),
      },
    });

    await tryHandleCommand('/doctor', ctx);

    expect(ctx.channel.sendMarkdown).toHaveBeenCalledWith(
      'chat-a',
      expect.stringContaining('诊断包发送失败'),
      { replyTo: 'msg-1' },
    );
  });

  it('does not turn a successful file upload into a failure when confirmation fails', async () => {
    const sendFile = vi.fn().mockResolvedValue(undefined);
    const ctx = makeContext({
      senderId: 'ou_owner',
      accessManager: makeAccessManager({ admins: ['ou_owner'] }),
      createDiagnosticBundle: vi.fn().mockResolvedValue({
        fileName: 'diagnostic.md',
        content: Buffer.from('safe'),
      }),
      channel: {
        sendMarkdown: vi.fn().mockRejectedValue(new Error('confirmation unavailable')),
        sendFile,
      },
    });

    await expect(tryHandleCommand('/doctor', ctx)).resolves.toBe(true);
    expect(sendFile).toHaveBeenCalledOnce();
  });

  it('reports a generation failure when diagnostic collection hangs', async () => {
    const ctx = makeContext({
      senderId: 'ou_owner',
      accessManager: makeAccessManager({ admins: ['ou_owner'] }),
      createDiagnosticBundle: vi.fn(() => new Promise<never>(() => undefined)),
      diagnosticTimeoutMs: { generate: 10, upload: 10 },
      channel: {
        sendMarkdown: vi.fn().mockResolvedValue(undefined),
        sendFile: vi.fn(),
      },
    });

    await expect(tryHandleCommand('/doctor', ctx)).resolves.toBe(true);
    expect(ctx.channel.sendFile).not.toHaveBeenCalled();
    expect(ctx.channel.sendMarkdown).toHaveBeenCalledWith(
      'chat-a',
      expect.stringContaining('诊断包生成失败'),
      { replyTo: 'msg-1' },
    );
  });

  it('reports an unknown result and does not claim success when a timed-out upload finishes late', async () => {
    let finishUpload: (() => void) | undefined;
    const upload = new Promise<void>((resolve) => {
      finishUpload = resolve;
    });
    const ctx = makeContext({
      senderId: 'ou_owner',
      accessManager: makeAccessManager({ admins: ['ou_owner'] }),
      createDiagnosticBundle: vi.fn().mockResolvedValue({
        fileName: 'diagnostic.md',
        content: Buffer.from('safe'),
      }),
      diagnosticTimeoutMs: { generate: 10, upload: 10 },
      channel: {
        sendMarkdown: vi.fn().mockResolvedValue(undefined),
        sendFile: vi.fn(() => upload),
      },
    });

    await expect(tryHandleCommand('/doctor', ctx)).resolves.toBe(true);
    finishUpload?.();
    await upload;
    expect(ctx.channel.sendMarkdown).toHaveBeenCalledWith(
      'chat-a',
      expect.stringContaining('结果未知'),
      { replyTo: 'msg-1' },
    );
    expect(ctx.channel.sendMarkdown).not.toHaveBeenCalledWith(
      'chat-a',
      expect.stringContaining('已生成并发送'),
      expect.anything(),
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
    expect(body).toContain('/mode');
    expect(body).toContain('/providers');
    expect(body).toContain('/provider');
    expect(body).toContain('/key');
    expect(body).toContain('/help');
    expect(body).toContain('/newg');
  });

  it('/mode opens a plain-language card and persists a selected mode for the scope', async () => {
    const modes = new ExecutionModeStore(':memory:');
    const sendCard = vi.fn().mockResolvedValue('mode-card');
    const ctx = makeContext({
      executionModes: modes,
      senderId: 'ou_user',
      channel: { sendMarkdown: vi.fn(), sendCard },
    });

    await tryHandleCommand('/mode', ctx);
    const card = JSON.stringify(sendCard.mock.calls[0]?.[1]);
    expect(card).toContain('快速');
    expect(card).toContain('平衡');
    expect(card).toContain('深度');
    expect(card).toContain('Quick');
    expect(card).toContain('Balance');
    expect(card).toContain('Deep');
    expect(card).toContain('"cmd":"execution-mode"');

    await tryHandleCommand('/mode deep', ctx);
    expect(modes.get('chat-a')).toBe('deep');
    expect(ctx.channel.sendMarkdown).toHaveBeenCalledWith(
      'chat-a',
      expect.stringContaining('下一轮'),
      { replyTo: 'msg-1' },
    );

    await tryHandleCommand('/effort quick', ctx);
    expect(modes.get('chat-a')).toBe('quick');
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

  it('/jobs only lists and retries jobs in the current scope and workspace', async () => {
    const jobs = new JobLedger(':memory:');
    await jobs.load();
    await jobs.enqueue({
      messageId: 'job-a', scope: 'chat-a', workspaceCwd: '/tmp/default', chatId: 'chat-a',
      chatType: 'p2p', senderId: 'user-a', senderType: 'user', content: 'deploy api_key=supersecret123',
      rawContentType: 'text', resources: [], mentions: [], mentionAll: false, mentionedBot: true,
      createTime: 1,
    });
    await jobs.markRunning(['job-a'], 'run-a');
    await jobs.finish(['job-a'], 'interrupted', 'bridge stopped');
    const requeueJob = vi.fn(async (id: string, scope: string, cwd: string) =>
      Boolean(await jobs.retry(id, scope, cwd)));
    const ctx = makeContext({ jobs, requeueJob });

    await tryHandleCommand('/jobs', ctx);
    const list = (ctx.channel.sendMarkdown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1] as string;
    expect(list).toContain('job-a');
    expect(list).toContain('interrupted');
    expect(list).not.toContain('secret');

    await tryHandleCommand('/jobs retry job-a', ctx);
    expect(requeueJob).toHaveBeenCalledWith('job-a', 'chat-a', '/tmp/default');
    expect(jobs.counts('chat-a', '/tmp/default').queued).toBe(1);
  });
});
