import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  LarkChannel,
  LarkChannelOptions,
  NormalizedMessage,
  SendOptions,
} from '@larksuite/channel';
import type {
  AgentAdapter,
  AgentAvailability,
  AgentEvent,
  AgentRun,
  AgentRunOptions,
} from '../../src/adapters/types.js';
import { ConfigStore } from '../../src/config/profile-store.js';
import { startHeartbeat } from '../../src/guardian/heartbeat.js';
import { GuardianService } from '../../src/guardian/service.js';
import {
  newGuardianState,
  saveGuardianState,
  type GuardianState,
} from '../../src/guardian/state.js';

const tempDirs: string[] = [];
const services: GuardianService[] = [];

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.stop()));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

type Handlers = Record<string, (...args: never[]) => unknown>;

function makeChannel() {
  const handlers: Handlers = {};
  const sent: Array<{ chatId: string; input: unknown; options: SendOptions | undefined }> = [];
  let createOptions: Record<string, unknown> | undefined;
  const channel = {
    on(next: Handlers) {
      Object.assign(handlers, next);
    },
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockImplementation(
      async (chatId: string, input: unknown, options?: SendOptions) => {
        sent.push({ chatId, input, options });
        return { messageId: 'sent-' + sent.length };
      },
    ),
    stream: vi.fn().mockResolvedValue(undefined),
  } as unknown as LarkChannel;
  return {
    channel,
    handlers,
    sent,
    get createOptions() {
      return createOptions;
    },
    createChannel: (options?: LarkChannelOptions) => {
      createOptions = options as Record<string, unknown> | undefined;
      return channel;
    },
  };
}

function makeAdapter(prompts: string[]): AgentAdapter {
  const events: AgentEvent[] = [
    { type: 'system', sessionId: undefined, cwd: undefined, model: undefined },
    { type: 'text', delta: 'fake ' },
    { type: 'final_text', content: 'fake answer' },
    { type: 'done', sessionId: undefined, terminationReason: 'normal' },
  ];
  return {
    id: 'fake-safe',
    displayName: 'Fake Safe',
    async isAvailable() {
      return true;
    },
    async checkAvailability(): Promise<AgentAvailability> {
      return { ok: true, error: undefined, version: 'test' };
    },
    run(options: AgentRunOptions): AgentRun {
      prompts.push(options.prompt);
      return {
        runId: options.runId,
        events: (async function* () {
          for (const event of events) yield event;
        })(),
        stop: async () => {},
        waitForExit: async () => true,
      };
    },
  };
}

function message(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    messageId: 'msg-1',
    chatId: 'chat-1',
    chatType: 'p2p',
    senderId: 'ou_admin',
    content: 'hello',
    rawContentType: 'text',
    resources: [],
    mentions: [],
    mentionAll: false,
    mentionedBot: false,
    createTime: Date.now(),
    ...overrides,
  };
}

async function makeHarness(
  overrides: {
    state?: Partial<GuardianState>;
    admins?: string[];
    allowedUsers?: string[];
    adapter?: AgentAdapter;
  } = {},
) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-guardian-'));
  tempDirs.push(dir);
  const configFile = join(dir, 'config.json');
  const stateFile = join(dir, 'guardian.json');
  const heartbeatFile = join(dir, 'heartbeat.json');
  const prompts: string[] = [];

  const store = new ConfigStore(configFile);
  await store.load();
  await store.saveProfile('default', {
    tenant: 'feishu',
    appId: 'cli_test',
    appSecret: 'secret',
    workspace: join(dir, 'workspace'),
    access: {
      allowedUsers: overrides.allowedUsers ?? ['ou_admin'],
      allowedChats: [],
      admins: overrides.admins ?? ['ou_admin'],
    },
  });
  const state = newGuardianState({ dshProfile: 'dsh-lark', bridgeProfile: 'default' });
  Object.assign(state, overrides.state ?? {});
  await saveGuardianState(stateFile, state);

  const channelMock = makeChannel();
  const adapter = overrides.adapter ?? makeAdapter(prompts);
  const spawnDetachedFn = vi.fn().mockReturnValue({ pid: 777 });
  const probeSafeProfileFn = vi
    .fn()
    .mockResolvedValue({ ok: true, stdout: '', stderr: '' });
  const saved: GuardianState[] = [];
  const saveState = vi.fn().mockImplementation(async (next: GuardianState) => {
    saved.push({ ...next });
  });

  const service = new GuardianService({
    stateFile,
    configFile,
    heartbeatFile,
    home: dir,
    dshProfile: 'dsh-lark',
    bridgeProfile: 'default',
    safeProfile: 'dsh-lark-safe',
    pollMs: 10,
    staleMs: 60,
    takeoverGracePolls: 1,
    sendDelayMs: 0,
    dshBin: '/fake/dsh/bin.js',
    createChannel: channelMock.createChannel,
    adapter,
    findProcess: async () => undefined,
    spawnDetachedFn,
    probeSafeProfileFn,
    saveState,
  });
  services.push(service);
  return {
    dir,
    stateFile,
    heartbeatFile,
    service,
    channel: channelMock.channel,
    handlers: channelMock.handlers,
    sent: channelMock.sent,
    prompts,
    adapter,
    spawnDetachedFn,
    probeSafeProfileFn,
    saved,
  };
}

async function until(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('condition not met in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('GuardianService', () => {
  it('stays silent while dsh is up and records profileSeenUp', async () => {
    const harness = await makeHarness();
    const heartbeat = startHeartbeat(harness.heartbeatFile, 1, 20);
    try {
      await harness.service.start();
      await sleep(60);
      expect(harness.handlers.message).toBeUndefined();
      expect(harness.sent).toHaveLength(0);
      expect(harness.service.snapshot().profileSeenUp).toBe(true);
      expect(harness.service.snapshot().mode).toBe('standby');
    } finally {
      heartbeat.stop();
    }
  });

  it('does not take over the channel before the profile was ever seen up', async () => {
    const harness = await makeHarness();
    await harness.service.start();
    await sleep(80);
    expect(harness.sent).toHaveLength(0);
    expect(harness.service.snapshot().mode).toBe('standby');
    expect(harness.service.snapshot().profileSeenUp).toBe(false);
  });

  it('takes over after dsh goes down, then releases when dsh returns', async () => {
    const harness = await makeHarness({ state: { profileSeenUp: true } });
    await harness.service.start();
    await until(() => harness.handlers.message !== undefined);
    expect(harness.service.snapshot().mode).toBe('takeover');

    // dsh comes back: fresh heartbeat → channel released.
    const heartbeat = startHeartbeat(harness.heartbeatFile, 2, 20);
    try {
      await until(() => (harness.channel.disconnect as ReturnType<typeof vi.fn>).mock.calls.length > 0);
      expect(harness.service.snapshot().mode).toBe('standby');
    } finally {
      heartbeat.stop();
    }
  });

  it('enters safe mode, runs a restricted conversation and keeps transcript context', async () => {
    const harness = await makeHarness({ state: { profileSeenUp: true } });
    await harness.service.start();
    await until(() => harness.handlers.message !== undefined);

    await harness.handlers.message?.(message({ content: '/safemode' }) as never);
    expect(harness.probeSafeProfileFn).toHaveBeenCalledWith(
      expect.objectContaining({ bin: '/fake/dsh/bin.js', dshProfile: 'dsh-lark' }),
    );
    expect(harness.service.snapshot().mode).toBe('safe');
    const enterReply = JSON.stringify(harness.sent.at(-1)?.input);
    expect(enterReply).toContain('安全模式已就绪');

    await harness.handlers.message?.(
      message({ messageId: 'm2', content: 'which plugin looks broken?' }) as never,
    );
    expect(harness.prompts[0]).toContain('which plugin looks broken?');
    const answerReply = harness.sent.at(-1)?.input;
    expect(JSON.stringify(answerReply)).toContain('fake answer');

    await harness.handlers.message?.(
      message({ messageId: 'm3', content: 'disable it' }) as never,
    );
    expect(harness.prompts[1]).toContain('which plugin looks broken?');
    expect(harness.prompts[1]).toContain('fake answer');
    expect(harness.prompts[1]).toContain('disable it');
  });

  it('rejects unauthorized senders silently', async () => {
    const harness = await makeHarness({ state: { profileSeenUp: true } });
    await harness.service.start();
    await until(() => harness.handlers.message !== undefined);
    const before = harness.sent.length;
    await harness.handlers.message?.(
      message({ senderId: 'ou_attacker', content: '/safemode' }) as never,
    );
    expect(harness.sent.length).toBe(before);
  });

  it('exits safe mode by relaunching the full profile and releasing the channel', async () => {
    const harness = await makeHarness({ state: { profileSeenUp: true, mode: 'safe' } });
    await harness.service.start();
    await until(() => harness.handlers.message !== undefined);
    expect(harness.service.snapshot().mode).toBe('safe');

    await harness.handlers.message?.(message({ content: '/safemode exit' }) as never);
    expect(harness.spawnDetachedFn).toHaveBeenCalledWith('node', [
      '/fake/dsh/bin.js',
      '--profile',
      'dsh-lark',
    ]);
    await until(() => (harness.channel.disconnect as ReturnType<typeof vi.fn>).mock.calls.length > 0);
    expect(harness.service.snapshot().mode).toBe('standby');
    expect(harness.service.snapshot().relaunchedPid).toBe(777);
  });

  it('reports status through the control channel', async () => {
    const harness = await makeHarness({ state: { profileSeenUp: true } });
    await harness.service.start();
    await until(() => harness.handlers.message !== undefined);
    await harness.handlers.message?.(message({ content: '/safemode status' }) as never);
    const text = JSON.stringify(harness.sent.at(-1)?.input);
    expect(text).toContain('takeover');
    expect(text).toContain('dsh-lark');
  });

  it('surfaces safe-profile probe failures to the user', async () => {
    const harness = await makeHarness({ state: { profileSeenUp: true } });
    harness.probeSafeProfileFn.mockResolvedValue({
      ok: false,
      stdout: '',
      stderr: 'cannot resolve bundle @deepseek-ai/dsh-headless',
      error: 'cannot resolve bundle @deepseek-ai/dsh-headless',
    });
    await harness.service.start();
    await until(() => harness.handlers.message !== undefined);
    await harness.handlers.message?.(message({ content: '/safemode' }) as never);
    const text = JSON.stringify(harness.sent.at(-1)?.input);
    expect(text).toContain('就绪检查失败');
    expect(text).toContain('cannot resolve bundle');
    expect(harness.service.snapshot().mode).not.toBe('safe');
  });
});
