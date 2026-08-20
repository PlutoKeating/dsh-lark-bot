import { describe, expect, it, vi } from 'vitest';
import type {
  LarkChannel,
  LarkChannelOptions,
  NormalizedMessage,
  SendOptions,
} from '@larksuite/channel';
import type { AgentAdapter, AgentAvailability, AgentRun } from '../../src/adapters/types.js';
import { ActiveRuns } from '../../src/bot/active-runs.js';
import { ApprovalRegistry } from '../../src/bot/approvals.js';
import { ConcurrencyStore } from '../../src/bot/concurrency-store.js';
import { ModelStore } from '../../src/bot/model-store.js';
import { QuestionRegistry } from '../../src/bot/questions.js';
import { PlanApprovalRegistry } from '../../src/bot/plan-approvals.js';
import { WizardStore } from '../../src/bot/wizard-store.js';
import { RetentionStore } from '../../src/bot/retention-store.js';
import { RoleStore } from '../../src/bot/role-store.js';
import { RunPolicyStore } from '../../src/bot/run-policy.js';
import { AccessManager } from '../../src/config/access-manager.js';
import { DshProviderManager } from '../../src/config/dsh-config.js';
import { ConfigStore } from '../../src/config/profile-store.js';
import { startChannel } from '../../src/bridge/channel.js';
import { SessionStore } from '../../src/session/store.js';
import { WorkspaceStore } from '../../src/workspace/store.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { JobLedger } from '../../src/bot/job-ledger.js';
import { ExecutionModeStore } from '../../src/bot/execution-mode-store.js';

type Handlers = Record<string, (...args: never[]) => unknown>;

function makeChannel(): {
  channel: LarkChannel;
  handlers: Handlers;
  sent: Array<{ chatId: string; input: unknown; options: SendOptions | undefined }>;
  updatedCards: Array<{ messageId: string; card: object }>;
  recalled: string[];
  chatGet: ReturnType<typeof vi.fn>;
  createChannel: (options?: LarkChannelOptions) => LarkChannel;
  createOptions: Record<string, unknown> | undefined;
} {
  const handlers: Handlers = {};
  const sent: Array<{ chatId: string; input: unknown; options: SendOptions | undefined }> = [];
  const recalled: string[] = [];
  const updatedCards: Array<{ messageId: string; card: object }> = [];
  const chatGet = vi.fn().mockResolvedValue({ data: {} });

  const channel = {
    rawClient: { im: { v1: { chat: { get: chatGet } } } },
    on(next: Handlers) {
      Object.assign(handlers, next);
    },
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockImplementation(
      async (chatId: string, input: unknown, options?: SendOptions) => {
        sent.push({ chatId, input, options });
        return { messageId: 'sent-message-id' };
      },
    ),
    stream: vi.fn().mockResolvedValue(undefined),
    updateCard: vi.fn().mockImplementation(async (messageId: string, card: object) => {
      updatedCards.push({ messageId, card });
    }),
    recallMessage: vi.fn().mockImplementation(async (messageId: string) => {
      recalled.push(messageId);
    }),
  } as unknown as LarkChannel;

  let createOptions: Record<string, unknown> | undefined;
  return {
    channel,
    handlers,
    sent,
    updatedCards,
    recalled,
    chatGet,
    get createOptions() {
      return createOptions;
    },
    createChannel: (options) => {
      createOptions = options as Record<string, unknown> | undefined;
      return channel;
    },
  };
}

function fakeAdapter(): AgentAdapter {
  return {
    id: 'dsh',
    displayName: 'DeepSeek Harness',
    async isAvailable() {
      return true;
    },
    async checkAvailability(): Promise<AgentAvailability> {
      return { ok: true, error: undefined, version: 'test' };
    },
    run(): AgentRun {
      throw new Error('not used in channel tests');
    },
  };
}

function message(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    messageId: 'msg-1',
    chatId: 'chat-1',
    chatType: 'p2p',
    senderId: 'user-1',
    content: 'hello',
    rawContentType: 'text',
    resources: [],
    mentions: [],
    mentionAll: false,
    mentionedBot: false,
    createTime: 1,
    ...overrides,
  };
}

describe('startChannel', () => {
  it('persists a current-scope mode card action and rejects stale or foreign actors', async () => {
    const fake = makeChannel();
    const executionModes = new ExecutionModeStore(':memory:');
    await startChannel({
      appId: 'cli_test', appSecret: 'secret', tenant: 'feishu', adapter: fakeAdapter(),
      sessions: new SessionStore(':memory:'), workspaces: new WorkspaceStore(':memory:'),
      activeRuns: new ActiveRuns(), runPolicies: new RunPolicyStore(),
      concurrencyStore: new ConcurrencyStore(), defaultScopeConcurrency: 2,
      retentionStore: new RetentionStore(), roleStore: new RoleStore(':memory:'),
      archiver: { archive: vi.fn(), list: vi.fn().mockResolvedValue([]), prune: vi.fn().mockResolvedValue(0) } as never,
      defaultRetention: 40, archiveMax: 50, archiveMaxAgeDays: 90,
      defaultRunTimeoutMs: 300_000, models: new ModelStore(), wizardStore: new WizardStore(),
      dshConfig: new DshProviderManager({ home: join(tmpdir(), 'dsh-lark-bot-mode-home') }),
      defaultModel: 'deepseek-v4-flash', executionModes,
      accessManager: new AccessManager(new ConfigStore(':memory:'), 'default'),
      pending: { push: vi.fn(), size: vi.fn().mockReturnValue(0), isFlushing: vi.fn().mockReturnValue(false), isBlocked: vi.fn().mockReturnValue(false) } as never,
      defaultWorkspace: '/tmp/project', createChannel: fake.createChannel,
    });

    const handle = fake.handlers.cardAction as (event: unknown) => Promise<{ toast?: { type: string } } | undefined>;
    const accepted = await handle({
      chatId: 'chat-1', messageId: 'mode-card', operator: { openId: 'user-1' },
      action: { value: { cmd: 'execution-mode', mode: 'deep', scope: 'chat-1', actorId: 'user-1' } },
    });
    expect(accepted?.toast?.type).toBe('success');
    expect(executionModes.get('chat-1')).toBe('deep');

    const rejected = await handle({
      chatId: 'chat-1', messageId: 'mode-card', operator: { openId: 'user-2' },
      action: { value: { cmd: 'execution-mode', mode: 'quick', scope: 'chat-1', actorId: 'user-1' } },
    });
    expect(rejected?.toast?.type).toBe('error');
    expect(executionModes.get('chat-1')).toBe('deep');
  });

  it('authorizes reply policy changes from the current Feishu group manager list', async () => {
    const fake = makeChannel();
    fake.chatGet.mockResolvedValue({
      data: { owner_id: 'ou_owner', user_manager_id_list: ['ou_manager'] },
    });
    const replyPolicies = {
      get: () => ({ mergeWindowMs: 0, maxBatchSize: 1, minIntervalMs: 0, dedupeWindowMs: 0 }),
      isConfigured: () => false,
      set: vi.fn().mockResolvedValue(undefined),
    };
    await startChannel({
      appId: 'cli_test', appSecret: 'secret', tenant: 'feishu', adapter: fakeAdapter(),
      sessions: new SessionStore(':memory:'), workspaces: new WorkspaceStore(':memory:'),
      activeRuns: new ActiveRuns(), runPolicies: new RunPolicyStore(),
      concurrencyStore: new ConcurrencyStore(), defaultScopeConcurrency: 2,
      retentionStore: new RetentionStore(), roleStore: new RoleStore(':memory:'),
      archiver: { archive: vi.fn(), list: vi.fn().mockResolvedValue([]), prune: vi.fn().mockResolvedValue(0) } as never,
      defaultRetention: 40, archiveMax: 50, archiveMaxAgeDays: 90,
      defaultRunTimeoutMs: 300_000, models: new ModelStore(), wizardStore: new WizardStore(),
      dshConfig: new DshProviderManager({ home: join(tmpdir(), 'dsh-lark-bot-group-admin-home') }),
      defaultModel: 'deepseek-v4-flash',
      accessManager: { isAdmin: () => false } as never,
      pending: { push: vi.fn(), size: vi.fn().mockReturnValue(0), isFlushing: vi.fn().mockReturnValue(false), isBlocked: vi.fn().mockReturnValue(false) } as never,
      replyPolicies: replyPolicies as never,
      defaultWorkspace: '/tmp/project', createChannel: fake.createChannel,
    });

    await (fake.handlers.message as (msg: NormalizedMessage) => Promise<void>)(message({
      messageId: 'manager-command', chatType: 'group', chatMode: 'group',
      senderId: 'ou_manager', mentionedBot: true, content: '/replies set merge=5',
    }));

    expect(fake.chatGet).toHaveBeenCalledWith({
      params: { user_id_type: 'open_id' },
      path: { chat_id: 'chat-1' },
    });
    expect(replyPolicies.set).toHaveBeenCalledWith('chat-1', {
      mergeWindowMs: 5_000,
      maxBatchSize: 1,
      minIntervalMs: 0,
      dedupeWindowMs: 0,
    });
  });

  it('accepts only trusted bot @ handoffs, bypasses slash commands and enforces the shared guard', async () => {
    const fake = makeChannel();
    const pending = {
      push: vi.fn(), size: vi.fn().mockReturnValue(0),
      isFlushing: vi.fn().mockReturnValue(false), isBlocked: vi.fn().mockReturnValue(false),
    };
    const handoffGuard = {
      recordHuman: vi.fn().mockResolvedValue(undefined),
      recordBot: vi.fn()
        .mockResolvedValueOnce({ allowed: true, firstTrip: false, count: 1 })
        .mockResolvedValueOnce({ allowed: false, firstTrip: true, count: 5 }),
    };
    await startChannel({
      appId: 'cli_test', appSecret: 'secret', tenant: 'feishu', adapter: fakeAdapter(),
      sessions: new SessionStore(':memory:'), workspaces: new WorkspaceStore(':memory:'),
      activeRuns: new ActiveRuns(), runPolicies: new RunPolicyStore(),
      concurrencyStore: new ConcurrencyStore(), defaultScopeConcurrency: 2,
      retentionStore: new RetentionStore(), roleStore: new RoleStore(':memory:'),
      archiver: { archive: vi.fn(), list: vi.fn().mockResolvedValue([]), prune: vi.fn().mockResolvedValue(0) } as never,
      defaultRetention: 40, archiveMax: 50, archiveMaxAgeDays: 90,
      defaultRunTimeoutMs: 300_000, models: new ModelStore(), wizardStore: new WizardStore(),
      dshConfig: new DshProviderManager({ home: join(tmpdir(), 'dsh-lark-bot-test-home') }),
      defaultModel: 'deepseek-v4-flash',
      accessManager: new AccessManager(new ConfigStore(':memory:'), 'default'),
      pending: pending as never, defaultWorkspace: '/tmp/project',
      isolationStore: { get: () => 'member' } as never,
      botHandoffMax: 4,
      isTrustedBot: async (openId) => openId === 'ou_reviewer_bot',
      handoffGuard,
      createChannel: fake.createChannel,
    });

    const handle = fake.handlers.message as (msg: NormalizedMessage) => Promise<void>;
    await handle(message({
      messageId: 'unknown-bot', chatType: 'group', senderType: 'bot', senderIsBot: true,
      senderId: 'ou_unknown_bot', mentionedBot: true, content: 'take over',
    }));
    expect(pending.push).not.toHaveBeenCalled();
    expect(handoffGuard.recordBot).not.toHaveBeenCalled();

    await handle(message({
      messageId: 'trusted-bot', chatType: 'group', senderType: 'bot', senderIsBot: true,
      senderId: 'ou_reviewer_bot', senderName: 'Reviewer Bot', mentionedBot: true,
      content: '/status please review commit abc',
    }));
    expect(pending.push).toHaveBeenCalledWith('chat-1', expect.objectContaining({
      content: '[来自可信机器人 Reviewer Bot 的交接]\n/status please review commit abc',
    }));
    expect(fake.sent).toHaveLength(0);

    await handle(message({
      messageId: 'trusted-bot-limit', chatType: 'group', senderType: 'bot', senderIsBot: true,
      senderId: 'ou_reviewer_bot', mentionedBot: true, content: 'another handoff',
    }));
    expect(JSON.stringify(fake.sent.at(-1)?.input)).toContain('4 轮上限');
    expect(pending.push).toHaveBeenCalledTimes(1);

    await handle(message({
      messageId: 'human-reset', chatType: 'group', senderType: 'user', senderIsBot: false,
      senderId: 'ou_human', mentionedBot: false, content: 'I am taking over',
    }));
    expect(handoffGuard.recordHuman).toHaveBeenCalledWith('chat-1');
    expect(pending.push).toHaveBeenCalledTimes(1);
  });

  it('refreshes a status card in place with the latest scope metrics', async () => {
    const fake = makeChannel();
    const sessions = new SessionStore(':memory:');
    sessions.set('chat-1', 'session-1', '/tmp/project');
    sessions.recordUsage('chat-1', '/tmp/project', { inputTokens: 25, outputTokens: 5 });
    sessions.recordContextUsage('chat-1', '/tmp/project', {
      usedTokens: 40,
      contextWindow: 100,
      sessionId: 'session-1',
      model: 'deepseek-official/deepseek-v4-flash',
    });

    await startChannel({
      appId: 'cli_test',
      appSecret: 'secret',
      tenant: 'feishu',
      adapter: fakeAdapter(),
      sessions,
      workspaces: new WorkspaceStore(':memory:'),
      activeRuns: new ActiveRuns(),
      runPolicies: new RunPolicyStore(),
      concurrencyStore: new ConcurrencyStore(),
      defaultScopeConcurrency: 2,
      retentionStore: new RetentionStore(),
      roleStore: new RoleStore(':memory:'),
      archiver: {
        archive: vi.fn(),
        list: vi.fn().mockResolvedValue([]),
        prune: vi.fn().mockResolvedValue(0),
      } as never,
      defaultRetention: 40,
      archiveMax: 50,
      archiveMaxAgeDays: 90,
      defaultRunTimeoutMs: 300_000,
      models: new ModelStore(),
      wizardStore: new WizardStore(),
      dshConfig: new DshProviderManager({
        home: join(tmpdir(), 'dsh-lark-bot-test-home'),
      }),
      defaultModel: 'deepseek-v4-flash',
      accessManager: new AccessManager(new ConfigStore(':memory:'), 'default'),
      pending: {
        push: vi.fn(),
        size: vi.fn().mockReturnValue(0),
        isFlushing: vi.fn().mockReturnValue(false),
        isBlocked: vi.fn().mockReturnValue(false),
      } as never,
      defaultWorkspace: '/tmp/project',
      createChannel: fake.createChannel,
    });

    const response = await (fake.handlers.cardAction as (event: unknown) => Promise<unknown>)({
      chatId: 'chat-1',
      messageId: 'status-message',
      operator: { openId: 'user-1' },
      action: { value: { cmd: 'status-refresh', scope: 'chat-1' } },
      raw: {},
    });

    expect(response).toEqual({ toast: { type: 'success', content: '状态已刷新 / Status refreshed' } });
    expect(fake.updatedCards).toHaveLength(1);
    expect(fake.updatedCards[0]?.messageId).toBe('status-message');
    expect(JSON.stringify(fake.updatedCards[0]?.card)).toContain('40 / 100（40.0%）');
    expect(fake.sent).toHaveLength(0);
  });

  it('confirms and recalls an approval card after resolving the permission request', async () => {
    const fake = makeChannel();
    const approvals = new ApprovalRegistry();
    const outcome = approvals.register('chat-1:member:user-1', {
      id: 'approval-1',
      sessionId: 'session-1',
      toolName: 'write_file',
      reason: 'write outside the workspace',
      options: [],
    });

    await startChannel({
      appId: 'cli_test',
      appSecret: 'secret',
      tenant: 'feishu',
      adapter: fakeAdapter(),
      sessions: new SessionStore(':memory:'),
      workspaces: new WorkspaceStore(':memory:'),
      activeRuns: new ActiveRuns(),
      runPolicies: new RunPolicyStore(),
      concurrencyStore: new ConcurrencyStore(),
      defaultScopeConcurrency: 2,
      retentionStore: new RetentionStore(),
      roleStore: new RoleStore(':memory:'),
      archiver: {
        archive: vi.fn(),
        list: vi.fn().mockResolvedValue([]),
        prune: vi.fn().mockResolvedValue(0),
      } as never,
      defaultRetention: 40,
      archiveMax: 50,
      archiveMaxAgeDays: 90,
      defaultRunTimeoutMs: 300_000,
      models: new ModelStore(),
      wizardStore: new WizardStore(),
      dshConfig: new DshProviderManager({
        home: join(tmpdir(), 'dsh-lark-bot-test-home'),
      }),
      defaultModel: 'deepseek-v4-flash',
      accessManager: new AccessManager(new ConfigStore(':memory:'), 'default'),
      pending: {
        push: vi.fn(),
        size: vi.fn().mockReturnValue(0),
        isFlushing: vi.fn().mockReturnValue(false),
        isBlocked: vi.fn().mockReturnValue(false),
      } as never,
      approvals,
      defaultWorkspace: '/tmp/project',
      createChannel: fake.createChannel,
    });

    const response = await (fake.handlers.cardAction as (event: unknown) => Promise<unknown>)({
      chatId: 'chat-1',
      messageId: 'approval-card-message',
      operator: { openId: 'user-1' },
      action: {
        value: {
          cmd: 'approve',
          id: 'approval-1',
          outcome: 'allow',
          scope: 'chat-1:member:user-1',
        },
      },
      raw: { message: { thread_id: 'thread-1' } },
    });

    await expect(outcome).resolves.toBe('allowed-once');
    expect(response).toEqual({
      toast: { type: 'success', content: '已允许 / Allowed' },
    });
    await vi.waitFor(() => {
      expect(JSON.stringify(fake.sent.at(-1)?.input)).toContain('已允许');
      expect(fake.sent.at(-1)?.options).toEqual({
        replyTo: 'approval-card-message',
        replyInThread: true,
      });
      expect(fake.recalled).toEqual(['approval-card-message']);
    });

    const confirmFailureOutcome = approvals.register('chat-1:thread-1', {
      id: 'approval-2',
      sessionId: 'session-1',
      toolName: 'write_file',
      reason: undefined,
      options: [],
    });
    vi.mocked(fake.channel.send).mockRejectedValueOnce(new Error('confirm unavailable'));
    await (fake.handlers.cardAction as (event: unknown) => Promise<unknown>)({
      chatId: 'chat-1',
      messageId: 'approval-card-confirm-failure',
      operator: { openId: 'user-1' },
      action: { value: { cmd: 'approve', id: 'approval-2', outcome: 'allow' } },
      raw: { message: { thread_id: 'thread-1' } },
    });
    await expect(confirmFailureOutcome).resolves.toBe('allowed-once');
    await vi.waitFor(() => {
      expect(fake.recalled).toContain('approval-card-confirm-failure');
    });

    const recallFailureOutcome = approvals.register('chat-1:thread-1', {
      id: 'approval-3',
      sessionId: 'session-1',
      toolName: 'write_file',
      reason: undefined,
      options: [],
    });
    vi.mocked(fake.channel.recallMessage).mockRejectedValueOnce(new Error('recall unavailable'));
    await (fake.handlers.cardAction as (event: unknown) => Promise<unknown>)({
      chatId: 'chat-1',
      messageId: 'approval-card-recall-failure',
      operator: { openId: 'user-1' },
      action: { value: { cmd: 'approve', id: 'approval-3', outcome: 'reject' } },
      raw: { message: { thread_id: 'thread-1' } },
    });
    await expect(recallFailureOutcome).resolves.toBe('rejected');
    await vi.waitFor(() => {
      expect(JSON.stringify(fake.sent.at(-1)?.input)).toContain('已拒绝');
    });
  });

  it('confirms and recalls a question card after recording the submitted answer', async () => {
    const fake = makeChannel();
    const questions = new QuestionRegistry();
    const plans = new PlanApprovalRegistry();
    const pendingQuestion = questions.register('chat-1:member:user-1', {
      question: 'Deploy now?',
      kind: 'single',
      options: ['Yes', 'No'],
    });

    await startChannel({
      appId: 'cli_test',
      appSecret: 'secret',
      tenant: 'feishu',
      adapter: fakeAdapter(),
      sessions: new SessionStore(':memory:'),
      workspaces: new WorkspaceStore(':memory:'),
      activeRuns: new ActiveRuns(),
      runPolicies: new RunPolicyStore(),
      concurrencyStore: new ConcurrencyStore(),
      defaultScopeConcurrency: 2,
      retentionStore: new RetentionStore(),
      roleStore: new RoleStore(':memory:'),
      archiver: {
        archive: vi.fn(),
        list: vi.fn().mockResolvedValue([]),
        prune: vi.fn().mockResolvedValue(0),
      } as never,
      defaultRetention: 40,
      archiveMax: 50,
      archiveMaxAgeDays: 90,
      defaultRunTimeoutMs: 300_000,
      models: new ModelStore(),
      wizardStore: new WizardStore(),
      dshConfig: new DshProviderManager({
        home: join(tmpdir(), 'dsh-lark-bot-test-home'),
      }),
      defaultModel: 'deepseek-v4-flash',
      accessManager: new AccessManager(new ConfigStore(':memory:'), 'default'),
      pending: {
        push: vi.fn(),
        size: vi.fn().mockReturnValue(0),
        isFlushing: vi.fn().mockReturnValue(false),
        isBlocked: vi.fn().mockReturnValue(false),
      } as never,
      questions,
      plans,
      defaultWorkspace: '/tmp/project',
      createChannel: fake.createChannel,
    });

    const response = await (fake.handlers.cardAction as (event: unknown) => Promise<unknown>)({
      chatId: 'chat-1',
      messageId: 'question-card-message',
      operator: { openId: 'user-1' },
      action: {
        value: {
          cmd: 'question-submit',
          id: pendingQuestion.id,
          scope: 'chat-1:member:user-1',
        },
        formValue: { answer: 'Yes' },
      },
    });

    await expect(pendingQuestion.promise).resolves.toBe('Yes');
    expect(response).toEqual({
      toast: { type: 'success', content: '回答已提交 / Answer submitted' },
    });
    await vi.waitFor(() => {
      expect(JSON.stringify(fake.sent.at(-1)?.input)).toContain('已提交');
      expect(fake.sent.at(-1)?.options).toEqual({ replyTo: 'question-card-message' });
      expect(fake.recalled).toEqual(['question-card-message']);
    });

    const pendingPlan = plans.register('chat-1', 'session-plan');
    const planResponse = await (fake.handlers.cardAction as (event: unknown) => Promise<unknown>)({
      chatId: 'chat-1',
      messageId: 'plan-card-message',
      operator: { openId: 'user-1' },
      action: {
        value: {
          cmd: 'plan-submit',
          id: pendingPlan.id,
          decision: 'revise',
          scope: 'chat-1',
        },
        formValue: { feedback: '先不要修改文件' },
      },
    });
    await expect(pendingPlan.promise).resolves.toEqual({
      decision: 'revise',
      feedback: '先不要修改文件',
    });
    expect(planResponse).toEqual({
      toast: { type: 'info', content: '已要求继续规划 / Continue planning requested' },
    });

    const stalePlanResponse = await (fake.handlers.cardAction as (event: unknown) => Promise<unknown>)({
      chatId: 'chat-1',
      messageId: 'plan-card-message',
      operator: { openId: 'user-1' },
      action: {
        value: {
          cmd: 'plan-submit',
          id: pendingPlan.id,
          decision: 'approved',
          scope: 'chat-1',
        },
      },
    });
    expect(stalePlanResponse).toEqual({
      toast: {
        type: 'error',
        content: '此计划卡已失效，请使用最新卡片 / This plan card is stale; use the latest card',
      },
    });
  });

  it('uses a non-mention text reply to the exact topic question card as its answer', async () => {
    const fake = makeChannel();
    const questions = new QuestionRegistry();
    const pendingQuestion = questions.register('chat-1:thread-1', {
      question: 'Which approach?',
      kind: 'single',
      options: ['A', 'B'],
    });
    questions.bindMessage('chat-1:thread-1', pendingQuestion.id, 'question-card-message');
    const pending = {
      push: vi.fn(),
      size: vi.fn().mockReturnValue(0),
      isFlushing: vi.fn().mockReturnValue(false),
      isBlocked: vi.fn().mockReturnValue(false),
    };

    await startChannel({
      appId: 'cli_test', appSecret: 'secret', tenant: 'feishu', adapter: fakeAdapter(),
      sessions: new SessionStore(':memory:'), workspaces: new WorkspaceStore(':memory:'),
      activeRuns: new ActiveRuns(), runPolicies: new RunPolicyStore(),
      concurrencyStore: new ConcurrencyStore(), defaultScopeConcurrency: 2,
      retentionStore: new RetentionStore(), roleStore: new RoleStore(':memory:'),
      archiver: { archive: vi.fn(), list: vi.fn().mockResolvedValue([]), prune: vi.fn().mockResolvedValue(0) } as never,
      defaultRetention: 40, archiveMax: 50, archiveMaxAgeDays: 90,
      defaultRunTimeoutMs: 300_000, models: new ModelStore(), wizardStore: new WizardStore(),
      dshConfig: new DshProviderManager({ home: join(tmpdir(), 'dsh-lark-bot-test-home') }),
      defaultModel: 'deepseek-v4-flash',
      accessManager: new AccessManager(new ConfigStore(':memory:'), 'default'),
      pending: pending as never, questions, defaultWorkspace: '/tmp/project',
      createChannel: fake.createChannel,
    });

    await (fake.handlers.message as (msg: NormalizedMessage) => Promise<void>)(message({
      messageId: 'wrong-thread-reply', chatId: 'chat-1', chatType: 'group', chatMode: 'topic',
      threadId: 'thread-2', senderId: 'user-1', content: 'wrong thread', rawContentType: 'text',
      replyToMessageId: 'question-card-message', mentionedBot: false,
    }));
    expect(questions.pendingCount('chat-1:thread-1')).toBe(1);
    expect(JSON.stringify(fake.sent.at(-1)?.input)).toContain('其他成员或其他话题');

    await (fake.handlers.message as (msg: NormalizedMessage) => Promise<void>)(message({
      messageId: 'image-reply', chatId: 'chat-1', chatType: 'group', chatMode: 'topic',
      threadId: 'thread-1', senderId: 'user-1', content: 'image-key', rawContentType: 'image',
      replyToMessageId: 'question-card-message', mentionedBot: false,
    }));
    expect(questions.pendingCount('chat-1:thread-1')).toBe(1);
    expect(JSON.stringify(fake.sent.at(-1)?.input)).toContain('非空文字');

    await (fake.handlers.message as (msg: NormalizedMessage) => Promise<void>)(message({
      messageId: 'answer-message', chatId: 'chat-1', chatType: 'group', chatMode: 'topic',
      threadId: 'thread-1', senderId: 'user-1', content: '  都不合适，换个思路  ',
      rawContentType: 'text', replyToMessageId: 'question-card-message', mentionedBot: false,
    }));

    await expect(pendingQuestion.promise).resolves.toBe('都不合适，换个思路');
    expect(pending.push).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(JSON.stringify(fake.sent.at(-1)?.input)).toContain('文字回答已记录');
      expect(fake.recalled).toContain('question-card-message');
    });
  });

  it('anchors a topic /ask card so a direct reply resumes the command', async () => {
    const fake = makeChannel();
    const questions = new QuestionRegistry();
    const pending = {
      push: vi.fn(), size: vi.fn().mockReturnValue(0),
      isFlushing: vi.fn().mockReturnValue(false), isBlocked: vi.fn().mockReturnValue(false),
    };

    await startChannel({
      appId: 'cli_test', appSecret: 'secret', tenant: 'feishu', adapter: fakeAdapter(),
      sessions: new SessionStore(':memory:'), workspaces: new WorkspaceStore(':memory:'),
      activeRuns: new ActiveRuns(), runPolicies: new RunPolicyStore(),
      concurrencyStore: new ConcurrencyStore(), defaultScopeConcurrency: 2,
      retentionStore: new RetentionStore(), roleStore: new RoleStore(':memory:'),
      archiver: { archive: vi.fn(), list: vi.fn().mockResolvedValue([]), prune: vi.fn().mockResolvedValue(0) } as never,
      defaultRetention: 40, archiveMax: 50, archiveMaxAgeDays: 90,
      defaultRunTimeoutMs: 300_000, models: new ModelStore(), wizardStore: new WizardStore(),
      dshConfig: new DshProviderManager({ home: join(tmpdir(), 'dsh-lark-bot-test-home') }),
      defaultModel: 'deepseek-v4-flash',
      accessManager: new AccessManager(new ConfigStore(':memory:'), 'default'),
      pending: pending as never, questions, defaultWorkspace: '/tmp/project',
      createChannel: fake.createChannel,
    });

    const command = (fake.handlers.message as (msg: NormalizedMessage) => Promise<void>)(message({
      messageId: 'ask-command', chatId: 'chat-1', chatType: 'group', chatMode: 'topic',
      threadId: 'thread-1', senderId: 'user-1', content: '/ask Why?', mentionedBot: true,
    }));
    await vi.waitFor(() => {
      expect(questions.pendingForMessage('sent-message-id')).toBeDefined();
    });
    expect(fake.sent[0]?.options).toEqual(expect.objectContaining({
      replyTo: 'ask-command',
      replyInThread: true,
    }));

    await (fake.handlers.message as (msg: NormalizedMessage) => Promise<void>)(message({
      messageId: 'ask-answer', chatId: 'chat-1', chatType: 'group', chatMode: 'topic',
      threadId: 'thread-1', senderId: 'user-1', content: 'Because',
      replyToMessageId: 'sent-message-id', mentionedBot: false,
    }));
    await command;

    expect(pending.push).not.toHaveBeenCalled();
    expect(fake.sent.some((item) => JSON.stringify(item.input).includes('已记录你的回答'))).toBe(true);
  });

  it('keeps member question replies owner-only after isolation switches', async () => {
    const fake = makeChannel();
    const questions = new QuestionRegistry();
    const pendingQuestion = questions.register('chat-1:member:user-1', {
      question: 'Add detail?', kind: 'multi', options: ['A', 'B'],
    });
    questions.bindMessage('chat-1:member:user-1', pendingQuestion.id, 'member-question-card');
    const pending = {
      push: vi.fn(), size: vi.fn().mockReturnValue(0),
      isFlushing: vi.fn().mockReturnValue(false), isBlocked: vi.fn().mockReturnValue(false),
    };

    await startChannel({
      appId: 'cli_test', appSecret: 'secret', tenant: 'feishu', adapter: fakeAdapter(),
      sessions: new SessionStore(':memory:'), workspaces: new WorkspaceStore(':memory:'),
      activeRuns: new ActiveRuns(), runPolicies: new RunPolicyStore(),
      concurrencyStore: new ConcurrencyStore(), defaultScopeConcurrency: 2,
      retentionStore: new RetentionStore(), roleStore: new RoleStore(':memory:'),
      isolationStore: { get: () => 'group', set: vi.fn() } as never,
      archiver: { archive: vi.fn(), list: vi.fn().mockResolvedValue([]), prune: vi.fn().mockResolvedValue(0) } as never,
      defaultRetention: 40, archiveMax: 50, archiveMaxAgeDays: 90,
      defaultRunTimeoutMs: 300_000, models: new ModelStore(), wizardStore: new WizardStore(),
      dshConfig: new DshProviderManager({ home: join(tmpdir(), 'dsh-lark-bot-test-home') }),
      defaultModel: 'deepseek-v4-flash',
      accessManager: new AccessManager(new ConfigStore(':memory:'), 'default'),
      pending: pending as never, questions, defaultWorkspace: '/tmp/project',
      createChannel: fake.createChannel,
    });

    await (fake.handlers.message as (msg: NormalizedMessage) => Promise<void>)(message({
      messageId: 'missing-operator-answer', chatId: 'chat-1', chatType: 'group', chatMode: 'group',
      senderId: '', content: 'anonymous answer', replyToMessageId: 'member-question-card',
    }));
    expect(questions.pendingCount('chat-1:member:user-1')).toBe(1);

    await (fake.handlers.message as (msg: NormalizedMessage) => Promise<void>)(message({
      messageId: 'foreign-answer', chatId: 'chat-1', chatType: 'group', chatMode: 'group',
      senderId: 'user-2', content: 'I will answer for them',
      replyToMessageId: 'member-question-card',
    }));
    expect(questions.pendingCount('chat-1:member:user-1')).toBe(1);
    expect(pending.push).not.toHaveBeenCalled();

    await (fake.handlers.message as (msg: NormalizedMessage) => Promise<void>)(message({
      messageId: 'owner-answer', chatId: 'chat-1', chatType: 'group', chatMode: 'group',
      senderId: 'user-1', content: 'Use C instead', replyToMessageId: 'member-question-card',
    }));
    await expect(pendingQuestion.promise).resolves.toBe('Use C instead');
    expect(pending.push).not.toHaveBeenCalled();
  });

  it('routes slash commands to the command channel and queues ordinary messages', async () => {
    const fake = makeChannel();
    const sessions = new SessionStore(':memory:');
    const workspaces = new WorkspaceStore(':memory:');
    const activeRuns = new ActiveRuns();
    const pending = {
      push: vi.fn(),
      size: vi.fn().mockReturnValue(0),
      isFlushing: vi.fn().mockReturnValue(false),
      isBlocked: vi.fn().mockReturnValue(false),
    };
    let isolationMode: 'group' | 'topic' | 'member' = 'topic';
    const isolationStore = {
      get: () => isolationMode,
      set: (_chatId: string, mode: 'group' | 'topic' | 'member') => { isolationMode = mode; },
    };

    await startChannel({
      appId: 'cli_test',
      appSecret: 'secret',
      tenant: 'feishu',
      adapter: fakeAdapter(),
      sessions,
      workspaces,
      activeRuns,
      runPolicies: new RunPolicyStore(),
      concurrencyStore: new ConcurrencyStore(),
      defaultScopeConcurrency: 2,
      retentionStore: new RetentionStore(),
      roleStore: new RoleStore(':memory:'),
      isolationStore: isolationStore as never,
      archiver: {
        archive: vi.fn(),
        list: vi.fn().mockResolvedValue([]),
        prune: vi.fn().mockResolvedValue(0),
      } as never,
      defaultRetention: 40,
      archiveMax: 50,
      archiveMaxAgeDays: 90,
      defaultRunTimeoutMs: 300_000,
      models: new ModelStore(),
      wizardStore: new WizardStore(),
      dshConfig: new DshProviderManager({
        home: join(tmpdir(), 'dsh-lark-bot-test-home'),
      }),
      defaultModel: 'deepseek-v4-flash',
      accessManager: new AccessManager(new ConfigStore(':memory:'), 'default'),
      pending: pending as never,
      defaultWorkspace: '/tmp/project',
      createChannel: fake.createChannel,
    });

    expect(fake.createOptions?.resolveChatMode).toBe(true);
    expect((fake.createOptions?.policy as { requireMention?: boolean })?.requireMention).toBe(false);

    await (fake.handlers.message as (msg: NormalizedMessage) => Promise<void>)(
      message({ content: '/status' }),
    );
    expect(fake.sent.length).toBe(1);
    expect(pending.push).not.toHaveBeenCalled();

    await (fake.handlers.message as (msg: NormalizedMessage) => Promise<void>)(
      message({ content: 'build this feature' }),
    );
    expect(pending.push).toHaveBeenCalledWith('chat-1', expect.objectContaining({
      content: 'build this feature',
      workspaceCwd: '/tmp/project',
    }));

    await (fake.handlers.message as (msg: NormalizedMessage) => Promise<void>)(message({
      messageId: 'unmentioned-group',
      chatType: 'group',
      chatMode: 'group',
      content: 'do not process me',
      mentionedBot: false,
    }));
    expect(pending.push).toHaveBeenCalledTimes(1);

    await (fake.handlers.message as (msg: NormalizedMessage) => Promise<void>)(message({
      messageId: 'switch-workspace',
      content: '/cd /tmp/project-b',
    }));
    await (fake.handlers.message as (msg: NormalizedMessage) => Promise<void>)(message({
      messageId: 'workspace-b-task',
      content: 'work in project b',
    }));
    expect(pending.push).toHaveBeenCalledWith('chat-1', expect.objectContaining({
      content: 'work in project b',
      workspaceCwd: '/tmp/project-b',
    }));

    isolationMode = 'member';
    await (fake.handlers.message as (msg: NormalizedMessage) => Promise<void>)(
      message({
        messageId: 'msg-member',
        chatType: 'group',
        chatMode: 'group',
        senderId: 'user-2',
        content: 'private workbench',
        mentionedBot: true,
      }),
    );
    expect(pending.push).toHaveBeenCalledWith(
      'chat-1:member:user-2',
      expect.objectContaining({ content: 'private workbench', workspaceCwd: '/tmp/project' }),
    );
  });

  it('interrupts the card run scope after isolation mode switches', async () => {
    const fake = makeChannel();
    const sessions = new SessionStore(':memory:');
    const workspaces = new WorkspaceStore(':memory:');
    const activeRuns = new ActiveRuns();
    const interrupt = vi.spyOn(activeRuns, 'interrupt').mockResolvedValue(1);
    const approvals = new ApprovalRegistry();
    const questions = new QuestionRegistry();
    const plans = new PlanApprovalRegistry();
    approvals.register('chat-1:member:user-1', {
      id: 'member-approval',
      sessionId: 'session-1',
      toolName: 'write_file',
      reason: undefined,
      options: [],
    });
    const memberQuestion = questions.register('chat-1:member:user-1', {
      question: 'Proceed?',
      kind: 'text',
    });
    const memberPlan = plans.register('chat-1:member:user-1', 'session-plan');
    const pending = {
      push: vi.fn(),
      size: vi.fn().mockReturnValue(0),
      isFlushing: vi.fn().mockReturnValue(false),
      isBlocked: vi.fn().mockReturnValue(false),
    };

    await startChannel({
      appId: 'cli_test',
      appSecret: 'secret',
      tenant: 'feishu',
      adapter: fakeAdapter(),
      sessions,
      workspaces,
      activeRuns,
      runPolicies: new RunPolicyStore(),
      concurrencyStore: new ConcurrencyStore(),
      defaultScopeConcurrency: 2,
      retentionStore: new RetentionStore(),
      roleStore: new RoleStore(':memory:'),
      approvals,
      questions,
      plans,
      archiver: {
        archive: vi.fn(),
        list: vi.fn().mockResolvedValue([]),
        prune: vi.fn().mockResolvedValue(0),
      } as never,
      defaultRetention: 40,
      archiveMax: 50,
      archiveMaxAgeDays: 90,
      defaultRunTimeoutMs: 300_000,
      models: new ModelStore(),
      wizardStore: new WizardStore(),
      dshConfig: new DshProviderManager({
        home: join(tmpdir(), 'dsh-lark-bot-test-home'),
      }),
      defaultModel: 'deepseek-v4-flash',
      accessManager: new AccessManager(new ConfigStore(':memory:'), 'default'),
      pending: pending as never,
      defaultWorkspace: '/tmp/project',
      createChannel: fake.createChannel,
    });

    await (fake.handlers.cardAction as (event: {
      chatId: string;
      action: { value: unknown };
      raw: { message?: { thread_id?: string } };
      operator?: { openId: string };
    }) => Promise<void>)({
      chatId: 'chat-1',
      action: { value: { cmd: 'stop', scope: 'chat-1:member:user-1' } },
      raw: { message: { thread_id: 'thread-9' } },
      operator: { openId: 'user-1' },
    });

    expect(interrupt).toHaveBeenCalledWith('chat-1:member:user-1');

    interrupt.mockClear();
    for (const value of [
      { cmd: 'stop', scope: 'chat-1:member:user-1' },
      {
        cmd: 'status-refresh',
        scope: 'chat-1:member:user-1',
        isolation: 'member',
      },
      {
        cmd: 'approve',
        id: 'member-approval',
        outcome: 'allow',
        scope: 'chat-1:member:user-1',
      },
      {
        cmd: 'question-submit',
        id: memberQuestion.id,
        scope: 'chat-1:member:user-1',
      },
      {
        cmd: 'plan-submit',
        id: memberPlan.id,
        decision: 'approved',
        scope: 'chat-1:member:user-1',
      },
    ]) {
      const rejected = await (fake.handlers.cardAction as (event: unknown) => Promise<unknown>)({
        chatId: 'chat-1',
        action: { value, formValue: { answer: 'yes' } },
        raw: { message: { thread_id: 'thread-9' } },
        operator: { openId: 'user-2' },
      });
      expect(rejected).toEqual({
        toast: { type: 'error', content: '不能操作其他成员的隔离会话 / You cannot operate another member’s isolated session' },
      });
    }
    expect(interrupt).not.toHaveBeenCalled();
    expect(approvals.pendingCount('chat-1:member:user-1')).toBe(1);
    expect(questions.pendingCount('chat-1:member:user-1')).toBe(1);
    expect(plans.pendingCount('chat-1:member:user-1')).toBe(1);

    const missingOperator = await (fake.handlers.cardAction as (event: unknown) => Promise<unknown>)({
      chatId: 'chat-1',
      action: { value: { cmd: 'stop', scope: 'chat-1:member:user-1' } },
      raw: { message: { thread_id: 'thread-9' } },
    });
    expect(missingOperator).toEqual({
      toast: { type: 'error', content: '不能操作其他成员的隔离会话 / You cannot operate another member’s isolated session' },
    });
    expect(interrupt).not.toHaveBeenCalled();
  });

  it('acknowledges the queue position when the scope is already busy', async () => {
    const fake = makeChannel();
    const sessions = new SessionStore(':memory:');
    const workspaces = new WorkspaceStore(':memory:');
    const activeRuns = new ActiveRuns();
    const pending = {
      push: vi.fn(),
      size: vi.fn().mockReturnValue(2),
      isFlushing: vi.fn().mockReturnValue(true),
      isBlocked: vi.fn().mockReturnValue(false),
    };

    await startChannel({
      appId: 'cli_test',
      appSecret: 'secret',
      tenant: 'feishu',
      adapter: fakeAdapter(),
      sessions,
      workspaces,
      activeRuns,
      runPolicies: new RunPolicyStore(),
      concurrencyStore: new ConcurrencyStore(),
      defaultScopeConcurrency: 2,
      retentionStore: new RetentionStore(),
      roleStore: new RoleStore(':memory:'),
      archiver: {
        archive: vi.fn(),
        list: vi.fn().mockResolvedValue([]),
        prune: vi.fn().mockResolvedValue(0),
      } as never,
      defaultRetention: 40,
      archiveMax: 50,
      archiveMaxAgeDays: 90,
      defaultRunTimeoutMs: 300_000,
      models: new ModelStore(),
      wizardStore: new WizardStore(),
      dshConfig: new DshProviderManager({
        home: join(tmpdir(), 'dsh-lark-bot-test-home'),
      }),
      defaultModel: 'deepseek-v4-flash',
      accessManager: new AccessManager(new ConfigStore(':memory:'), 'default'),
      pending: pending as never,
      defaultWorkspace: '/tmp/project',
      createChannel: fake.createChannel,
    });

    await (fake.handlers.message as (msg: NormalizedMessage) => Promise<void>)(
      message({ messageId: 'm2', content: 'another task' }),
    );
    const ack = fake.sent.at(-1);
    expect(JSON.stringify(ack?.input)).toContain('排队中');
    expect(ack?.options).toEqual({ replyTo: 'm2' });
    expect(pending.push).toHaveBeenCalledWith(
      'chat-1',
      expect.objectContaining({ content: 'another task' }),
    );
  });

  it('routes polled no-at group messages through the live pipeline without duplicating events', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const fake = makeChannel();
    const pending = {
      push: vi.fn(),
      size: vi.fn().mockReturnValue(0),
      isFlushing: vi.fn().mockReturnValue(false),
      isBlocked: vi.fn().mockReturnValue(false),
    };
    const historyItem = (messageId: string) => ({
      messageId,
      chatId: 'oc-group',
      createTime: 10_001,
      senderId: 'ou-allowed',
      senderType: 'user',
      messageType: 'text',
      deleted: false,
    });
    const groupHistorySource = {
      listMessages: vi.fn().mockResolvedValue({
        items: [historyItem('om-event'), historyItem('om-polled')],
        hasMore: false,
      }),
      fetchMessage: vi.fn().mockImplementation(async (messageId: string) =>
        message({
          messageId,
          chatId: 'oc-group',
          chatType: 'group',
          chatMode: 'group',
          senderId: 'ou-allowed',
          senderType: 'user',
          senderIsBot: false,
          content: messageId === 'om-event' ? 'event copy' : 'without mention',
          createTime: 10_001,
        }),
      ),
    };
    const scopeDirectory = {
      register: vi.fn(),
      knownChats: () => [{ chatId: 'oc-group', chatMode: 'group' as const }],
      resolve: vi.fn(),
      resolveChat: vi.fn(),
      knownScopes: vi.fn().mockReturnValue(['oc-group']),
      flush: vi.fn(),
    };
    vi.mocked(fake.channel.connect).mockImplementation(async () => {
      await (fake.handlers.message as (msg: NormalizedMessage) => Promise<void>)(
        message({
          messageId: 'om-event',
          chatId: 'oc-group',
          chatType: 'group',
          chatMode: 'group',
          senderId: 'ou-allowed',
          senderType: 'user',
          content: 'live event during connect',
          createTime: 10_001,
        }),
      );
      await (fake.handlers.message as (msg: NormalizedMessage) => Promise<void>)(
        message({
          messageId: 'om-unauthorized',
          chatId: 'oc-group',
          chatType: 'group',
          chatMode: 'group',
          senderId: 'ou-not-allowed',
          senderType: 'user',
          content: 'unmentioned unauthorized live event',
          createTime: 10_001,
        }),
      );
    });
    let bridge: Awaited<ReturnType<typeof startChannel>> | undefined;
    try {
      bridge = await startChannel({
        appId: 'cli_test',
        appSecret: 'secret',
        tenant: 'feishu',
        adapter: fakeAdapter(),
        sessions: new SessionStore(':memory:'),
        workspaces: new WorkspaceStore(':memory:'),
        activeRuns: new ActiveRuns(),
        runPolicies: new RunPolicyStore(),
        concurrencyStore: new ConcurrencyStore(),
        defaultScopeConcurrency: 2,
        retentionStore: new RetentionStore(),
        roleStore: new RoleStore(':memory:'),
        scopeDirectory: scopeDirectory as never,
        archiver: {
          archive: vi.fn(),
          list: vi.fn().mockResolvedValue([]),
          prune: vi.fn().mockResolvedValue(0),
        } as never,
        defaultRetention: 40,
        archiveMax: 50,
        archiveMaxAgeDays: 90,
        defaultRunTimeoutMs: 300_000,
        models: new ModelStore(),
        wizardStore: new WizardStore(),
        dshConfig: new DshProviderManager({
          home: join(tmpdir(), 'dsh-lark-bot-test-home'),
        }),
        defaultModel: 'deepseek-v4-flash',
        accessManager: {
          snapshot: () => ({
            allowedUsers: ['ou-allowed'],
            allowedChats: [],
            admins: [],
          }),
        } as never,
        pending: pending as never,
        defaultWorkspace: '/tmp/project',
        eventFreshnessMs: 600_000,
        groupNoAt: true,
        groupPollMs: 3_000,
        groupHistorySource,
        createChannel: fake.createChannel,
      });

      await vi.advanceTimersByTimeAsync(3_000);

      expect(pending.push.mock.calls.map(([, msg]) => msg.messageId)).toEqual([
        'om-event',
        'om-polled',
      ]);
      expect(groupHistorySource.fetchMessage).toHaveBeenCalledTimes(1);
      expect(scopeDirectory.register).toHaveBeenCalledWith(
        'oc-group',
        'oc-group',
        undefined,
        'group',
        'om-event',
      );
    } finally {
      await bridge?.disconnect();
      vi.useRealTimers();
    }
  });

  it('routes wizard card actions to the interactive config flow', async () => {
    const fake = makeChannel();
    const sessions = new SessionStore(':memory:');
    const workspaces = new WorkspaceStore(':memory:');
    const activeRuns = new ActiveRuns();
    const pending = {
      push: vi.fn(),
      size: vi.fn().mockReturnValue(0),
      isFlushing: vi.fn().mockReturnValue(false),
      isBlocked: vi.fn().mockReturnValue(false),
    };
    const configStore = new ConfigStore(':memory:');
    await configStore.load();
    await configStore.saveProfile('default', {
      tenant: 'feishu',
      appId: 'cli_test',
      appSecret: 'secret',
      access: { allowedUsers: ['ou_admin'], allowedChats: [], admins: ['ou_admin'] },
    });

    await startChannel({
      appId: 'cli_test',
      appSecret: 'secret',
      tenant: 'feishu',
      adapter: fakeAdapter(),
      sessions,
      workspaces,
      activeRuns,
      runPolicies: new RunPolicyStore(),
      concurrencyStore: new ConcurrencyStore(),
      defaultScopeConcurrency: 2,
      retentionStore: new RetentionStore(),
      roleStore: new RoleStore(':memory:'),
      archiver: {
        archive: vi.fn(),
        list: vi.fn().mockResolvedValue([]),
        prune: vi.fn().mockResolvedValue(0),
      } as never,
      defaultRetention: 40,
      archiveMax: 50,
      archiveMaxAgeDays: 90,
      defaultRunTimeoutMs: 300_000,
      models: new ModelStore(),
      wizardStore: new WizardStore(),
      dshConfig: new DshProviderManager({
        home: join(tmpdir(), 'dsh-lark-bot-test-home'),
      }),
      defaultModel: 'deepseek-v4-flash',
      accessManager: new AccessManager(configStore, 'default'),
      pending: pending as never,
      defaultWorkspace: '/tmp/project',
      createChannel: fake.createChannel,
    });

    // Admin clicks "添加 Provider" on the hub card.
    await (fake.handlers.cardAction as (event: unknown) => Promise<void>)({
      chatId: 'chat-1',
      operator: { openId: 'ou_admin' },
      action: { value: { cmd: 'cfg', action: 'provider-add' }, tag: 'button' },
    });
    const wizardCard = fake.sent.find((entry) => {
      return (entry.input as { card?: unknown })?.card !== undefined;
    });
    expect(wizardCard).toBeDefined();
    expect(JSON.stringify(wizardCard?.input)).toContain('openai-completions');

    // Pick the first protocol option (openai-completions).
    await (fake.handlers.cardAction as (event: unknown) => Promise<void>)({
      chatId: 'chat-1',
      operator: { openId: 'ou_admin' },
      action: {
        value: { cmd: 'wizard', flow: 'provider-add', step: 0, choose: 0 },
        tag: 'button',
      },
    });

    // Submit the provider id step through the wizard card.
    await (fake.handlers.cardAction as (event: unknown) => Promise<void>)({
      chatId: 'chat-1',
      operator: { openId: 'ou_admin' },
      action: {
        value: { cmd: 'wizard', flow: 'provider-add', step: 1, submit: true },
        tag: 'button',
        formValue: { answer: 'kingapi' },
      },
    });
    const nextCard = fake.sent[fake.sent.length - 1];
    expect(JSON.stringify(nextCard?.input)).toContain('Base URL');
  });

  it('reports a failing command instead of forwarding it to the agent', async () => {
    const fake = makeChannel();
    const sessions = new SessionStore(':memory:');
    const workspaces = new WorkspaceStore(':memory:');
    const activeRuns = new ActiveRuns();
    const pending = {
      push: vi.fn(),
      size: vi.fn().mockReturnValue(0),
      isFlushing: vi.fn().mockReturnValue(false),
      isBlocked: vi.fn().mockReturnValue(false),
    };
    const home = join(tmpdir(), 'dsh-lark-bot-bad-settings');
    await mkdir(join(home, '.dsh'), { recursive: true });
    await writeFile(join(home, '.dsh', 'settings.yaml'), 'llm-pi-ai: [broken\n');

    await startChannel({
      appId: 'cli_test',
      appSecret: 'secret',
      tenant: 'feishu',
      adapter: fakeAdapter(),
      sessions,
      workspaces,
      activeRuns,
      runPolicies: new RunPolicyStore(),
      concurrencyStore: new ConcurrencyStore(),
      defaultScopeConcurrency: 2,
      retentionStore: new RetentionStore(),
      roleStore: new RoleStore(':memory:'),
      archiver: {
        archive: vi.fn(),
        list: vi.fn().mockResolvedValue([]),
        prune: vi.fn().mockResolvedValue(0),
      } as never,
      defaultRetention: 40,
      archiveMax: 50,
      archiveMaxAgeDays: 90,
      defaultRunTimeoutMs: 300_000,
      models: new ModelStore(),
      wizardStore: new WizardStore(),
      dshConfig: new DshProviderManager({ home }),
      defaultModel: 'deepseek-v4-flash',
      accessManager: new AccessManager(new ConfigStore(':memory:'), 'default'),
      pending: pending as never,
      defaultWorkspace: '/tmp/project',
      createChannel: fake.createChannel,
    });

    await (fake.handlers.message as (msg: NormalizedMessage) => Promise<void>)(
      message({ messageId: 'm-bad', content: '/providers' }),
    );
    const reply = fake.sent.at(-1);
    expect(JSON.stringify(reply?.input)).toContain('命令执行失败');
    expect(pending.push).not.toHaveBeenCalled();
  });

  it('persists an accepted message before enqueue and deduplicates replayed or near-identical events', async () => {
    const fake = makeChannel();
    const pending = {
      push: vi.fn(), size: vi.fn().mockReturnValue(0),
      isFlushing: vi.fn().mockReturnValue(false), isBlocked: vi.fn().mockReturnValue(false),
    };
    const jobs = new JobLedger(':memory:');
    await jobs.load();
    await startChannel({
      appId: 'cli_test', appSecret: 'secret', tenant: 'feishu', adapter: fakeAdapter(),
      sessions: new SessionStore(':memory:'), workspaces: new WorkspaceStore(':memory:'),
      activeRuns: new ActiveRuns(), runPolicies: new RunPolicyStore(),
      concurrencyStore: new ConcurrencyStore(), defaultScopeConcurrency: 2,
      retentionStore: new RetentionStore(), roleStore: new RoleStore(':memory:'),
      archiver: { archive: vi.fn(), list: vi.fn().mockResolvedValue([]), prune: vi.fn().mockResolvedValue(0) } as never,
      defaultRetention: 40, archiveMax: 50, archiveMaxAgeDays: 90,
      defaultRunTimeoutMs: 300_000, models: new ModelStore(), wizardStore: new WizardStore(),
      dshConfig: new DshProviderManager({ home: join(tmpdir(), 'dsh-lark-bot-ledger-home') }),
      defaultModel: 'deepseek-v4-flash',
      accessManager: new AccessManager(new ConfigStore(':memory:'), 'default'),
      pending: pending as never, jobs, defaultWorkspace: '/tmp/project',
      replyPolicies: { get: () => ({ mergeWindowMs: 0, maxBatchSize: 1, minIntervalMs: 0, dedupeWindowMs: 60_000 }) } as never,
      createChannel: fake.createChannel,
    });

    const handle = fake.handlers.message as (msg: NormalizedMessage) => Promise<void>;
    await handle(message({ messageId: 'durable-message', content: 'Please review the checkout failure and propose a safe fix.' }));
    await handle(message({ messageId: 'durable-message', content: 'Please review the checkout failure and propose a safe fix.' }));
    await handle(message({ messageId: 'near-duplicate', content: 'Please review the checkout failure, and propose a safe fix!' }));

    expect(jobs.queued()).toHaveLength(1);
    expect(jobs.queued()[0]?.message).toMatchObject({
      messageId: 'durable-message', scope: 'chat-1', workspaceCwd: '/tmp/project',
    });
    expect(pending.push).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(fake.sent.at(-1)?.input)).toContain('近似重复任务');
  });

  it('fails closed with a visible receipt when durable enqueue cannot be persisted', async () => {
    const fake = makeChannel();
    const pending = {
      push: vi.fn(), size: vi.fn().mockReturnValue(0),
      isFlushing: vi.fn().mockReturnValue(false), isBlocked: vi.fn().mockReturnValue(false),
    };
    await startChannel({
      appId: 'cli_test', appSecret: 'secret', tenant: 'feishu', adapter: fakeAdapter(),
      sessions: new SessionStore(':memory:'), workspaces: new WorkspaceStore(':memory:'),
      activeRuns: new ActiveRuns(), runPolicies: new RunPolicyStore(),
      concurrencyStore: new ConcurrencyStore(), defaultScopeConcurrency: 2,
      retentionStore: new RetentionStore(), roleStore: new RoleStore(':memory:'),
      archiver: { archive: vi.fn(), list: vi.fn().mockResolvedValue([]), prune: vi.fn().mockResolvedValue(0) } as never,
      defaultRetention: 40, archiveMax: 50, archiveMaxAgeDays: 90,
      defaultRunTimeoutMs: 300_000, models: new ModelStore(), wizardStore: new WizardStore(),
      dshConfig: new DshProviderManager({ home: join(tmpdir(), 'dsh-lark-bot-ledger-fail-home') }),
      defaultModel: 'deepseek-v4-flash',
      accessManager: new AccessManager(new ConfigStore(':memory:'), 'default'),
      pending: pending as never,
      jobs: { enqueue: vi.fn().mockRejectedValue(new Error('disk full')) } as never,
      defaultWorkspace: '/tmp/project', createChannel: fake.createChannel,
    });

    await (fake.handlers.message as (msg: NormalizedMessage) => Promise<void>)(
      message({ messageId: 'not-durable', content: 'must not run' }),
    );

    expect(pending.push).not.toHaveBeenCalled();
    expect(JSON.stringify(fake.sent.at(-1)?.input)).toContain('未能写入持久任务账本');
    expect(JSON.stringify(fake.sent.at(-1)?.input)).toContain('not-durable');
  });
});
