import { describe, expect, it, vi } from 'vitest';
import type {
  LarkChannel,
  NormalizedMessage,
  SendOptions,
} from '@larksuite/channel';
import type { AgentAdapter, AgentAvailability, AgentRun } from '../../src/adapters/types.js';
import { ActiveRuns } from '../../src/bot/active-runs.js';
import { RunPolicyStore } from '../../src/bot/run-policy.js';
import { startChannel } from '../../src/bridge/channel.js';
import { SessionStore } from '../../src/session/store.js';
import { WorkspaceStore } from '../../src/workspace/store.js';

type Handlers = Record<string, (...args: never[]) => unknown>;

function makeChannel(): {
  channel: LarkChannel;
  handlers: Handlers;
  sent: Array<{ chatId: string; input: unknown; options: SendOptions | undefined }>;
  createChannel: () => LarkChannel;
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

  return {
    channel,
    handlers,
    sent,
    createChannel: () => channel,
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
    const pending = { push: vi.fn() };

    await startChannel({
      appId: 'cli_test',
      appSecret: 'secret',
      tenant: 'feishu',
      adapter: fakeAdapter(),
      sessions,
      workspaces,
      activeRuns,
      runPolicies: new RunPolicyStore(),
      defaultRunTimeoutMs: 300_000,
      pending: pending as never,
      defaultWorkspace: '/tmp/project',
      createChannel: fake.createChannel,
    });

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
    const interrupt = vi.spyOn(activeRuns, 'interrupt').mockResolvedValue(true);
    const pending = { push: vi.fn() };

    await startChannel({
      appId: 'cli_test',
      appSecret: 'secret',
      tenant: 'feishu',
      adapter: fakeAdapter(),
      sessions,
      workspaces,
      activeRuns,
      runPolicies: new RunPolicyStore(),
      defaultRunTimeoutMs: 300_000,
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
});
