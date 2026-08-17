import { describe, expect, it, vi } from 'vitest';
import type {
  LarkChannel,
  LarkChannelOptions,
  NormalizedMessage,
  SendOptions,
} from '@larksuite/channel';
import type { AgentAdapter, AgentAvailability, AgentRun } from '../../src/adapters/types.js';
import { ActiveRuns } from '../../src/bot/active-runs.js';
import { ConcurrencyStore } from '../../src/bot/concurrency-store.js';
import { ModelStore } from '../../src/bot/model-store.js';
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

type Handlers = Record<string, (...args: never[]) => unknown>;

function makeChannel(): {
  channel: LarkChannel;
  handlers: Handlers;
  sent: Array<{ chatId: string; input: unknown; options: SendOptions | undefined }>;
  createChannel: (options?: LarkChannelOptions) => LarkChannel;
  createOptions: Record<string, unknown> | undefined;
} {
  const handlers: Handlers = {};
  const sent: Array<{ chatId: string; input: unknown; options: SendOptions | undefined }> = [];

  const channel = {
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
  } as unknown as LarkChannel;

  let createOptions: Record<string, unknown> | undefined;
  return {
    channel,
    handlers,
    sent,
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

    expect(fake.createOptions?.resolveChatMode).toBe(true);

    await (fake.handlers.message as (msg: NormalizedMessage) => Promise<void>)(
      message({ content: '/status' }),
    );
    expect(fake.sent.length).toBe(1);
    expect(pending.push).not.toHaveBeenCalled();

    await (fake.handlers.message as (msg: NormalizedMessage) => Promise<void>)(
      message({ content: 'build this feature' }),
    );
    expect(pending.push).toHaveBeenCalledWith('chat-1', expect.objectContaining({ content: 'build this feature' }));
  });

  it('interrupts the topic scope when a card stop button is pressed', async () => {
    const fake = makeChannel();
    const sessions = new SessionStore(':memory:');
    const workspaces = new WorkspaceStore(':memory:');
    const activeRuns = new ActiveRuns();
    const interrupt = vi.spyOn(activeRuns, 'interrupt').mockResolvedValue(1);
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
    }) => Promise<void>)({
      chatId: 'chat-1',
      action: { value: { cmd: 'stop' } },
      raw: { message: { thread_id: 'thread-9' } },
    });

    expect(interrupt).toHaveBeenCalledWith('chat-1:thread-9');
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
});
