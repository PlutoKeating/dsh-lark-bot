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
import {
  GuardianService,
  type GuardianServiceOptions,
} from '../../src/guardian/service.js';
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
  const streamed: object[] = [];
  const streamCalls: Array<{
    chatId: string;
    input: unknown;
    options: SendOptions | undefined;
  }> = [];
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
    stream: vi.fn().mockImplementation(
      async (chatId: string, input: unknown, options?: SendOptions) => {
        streamCalls.push({ chatId, input, options });
        const card = (input as {
          card?: {
            initial: object;
            producer: (controller: { update: (card: object) => Promise<void> }) => Promise<void>;
          };
        }).card;
        if (card) {
          streamed.push(card.initial);
          await card.producer({
            update: async (next: object) => {
              streamed.push(next);
            },
          });
        }
        return { messageId: 'stream-' + streamed.length };
      },
    ),
  } as unknown as LarkChannel;
  return {
    channel,
    handlers,
    sent,
    streamed,
    streamCalls,
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

function makeHangingAdapter(): {
  adapter: AgentAdapter;
  release: () => void;
  stopCalls: () => number;
} {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let stopCalls = 0;
  const adapter: AgentAdapter = {
    id: 'fake-hang',
    displayName: 'Fake Hang',
    async isAvailable() {
      return true;
    },
    async checkAvailability(): Promise<AgentAvailability> {
      return { ok: true, error: undefined, version: 'test' };
    },
    run(options: AgentRunOptions): AgentRun {
      return {
        runId: options.runId,
        events: (async function* () {
          yield { type: 'system', sessionId: undefined, cwd: undefined, model: undefined };
          yield { type: 'text', delta: 'working…' };
          await gate;
          yield { type: 'final_text', content: 'done' };
          yield { type: 'done', sessionId: undefined, terminationReason: 'normal' };
        })(),
        stop: async () => {
          stopCalls += 1;
          release();
        },
        waitForExit: async () => true,
      };
    },
  };
  return { adapter, release, stopCalls: () => stopCalls };
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
    noAdapter?: boolean;
    safeAdapterMode?: 'auto' | 'sdk' | 'headless';
    safeTimeoutMs?: number;
    ensureSdkProfile?: GuardianServiceOptions['ensureSdkProfile'];
    engineDeadMs?: number;
    relaunchReadyTimeoutMs?: number;
    findProcess?: (dshProfile: string) => Promise<{ pid: number; cmdline: string } | undefined>;
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
  const adapter = overrides.noAdapter
    ? undefined
    : (overrides.adapter ?? makeAdapter(prompts));
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
    engineDeadMs: overrides.engineDeadMs ?? 120_000,
    takeoverGracePolls: 1,
    sendDelayMs: 0,
    dshBin: '/fake/dsh/bin.js',
    createChannel: channelMock.createChannel,
    ...(adapter === undefined ? {} : { adapter }),
    findProcess: overrides.findProcess ?? (async () => undefined),
    spawnDetachedFn,
    probeSafeProfileFn,
    saveState,
    ...(overrides.safeAdapterMode === undefined
      ? {}
      : { safeAdapterMode: overrides.safeAdapterMode }),
    ...(overrides.safeTimeoutMs === undefined
      ? {}
      : { safeTimeoutMs: overrides.safeTimeoutMs }),
    ...(overrides.ensureSdkProfile === undefined
      ? {}
      : { ensureSdkProfile: overrides.ensureSdkProfile }),
    relaunchReadyTimeoutMs: overrides.relaunchReadyTimeoutMs ?? 50,
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
    streamed: channelMock.streamed,
    streamCalls: channelMock.streamCalls,
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
    // A short readiness window: the auto-relaunch does not come up, so the
    // guardian gives up and takes over the rescue channel.
    const harness = await makeHarness({
      state: { profileSeenUp: true },
      relaunchReadyTimeoutMs: 50,
    });
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

  it('auto-relaunches once and does not take over while the relaunch is pending', async () => {
    const harness = await makeHarness({
      state: { profileSeenUp: true },
      relaunchReadyTimeoutMs: 50,
    });
    await harness.service.start();
    await until(() => harness.spawnDetachedFn.mock.calls.length > 0);
    expect(harness.service.snapshot().relaunchedPid).toBe(777);
    expect((harness.channel.connect as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);

    // The relaunch never comes up: after the readiness window the guardian
    // gives up, converges the state and takes over the rescue channel.
    await until(() => harness.service.snapshot().mode === 'takeover');
    expect(harness.service.snapshot().relaunchedPid).toBeUndefined();
    expect(harness.spawnDetachedFn.mock.calls.length).toBe(1);
  });

  it('marks the auto-relaunch ready and converges when the profile comes back', async () => {
    let calls = 0;
    const harness = await makeHarness({
      state: { profileSeenUp: true },
      relaunchReadyTimeoutMs: 10_000,
      findProcess: async () => {
        calls += 1;
        // First tick: profile down (tick check + pre-spawn re-check both see
        // nothing, so the spawn happens). Afterwards it is up.
        return calls > 2 ? { pid: 777, cmdline: 'dsh --profile dsh-lark' } : undefined;
      },
    });
    await harness.service.start();
    await until(() => harness.spawnDetachedFn.mock.calls.length > 0);
    expect((harness.channel.connect as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);

    await until(() => harness.service.snapshot().relaunchedPid === undefined);
    expect(harness.service.snapshot().mode).toBe('standby');
    expect((harness.channel.connect as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it('skips the auto-relaunch when a profile process appears right before the spawn', async () => {
    let calls = 0;
    const harness = await makeHarness({
      state: { profileSeenUp: true },
      findProcess: async () => {
        calls += 1;
        return calls >= 2 ? { pid: 42, cmdline: 'dsh --profile dsh-lark' } : undefined;
      },
    });
    await harness.service.start();
    await sleep(80);
    expect(harness.spawnDetachedFn.mock.calls.length).toBe(0);
  });

  it('takes over when the bridge engine is dead even though the dsh process survives', async () => {
    const harness = await makeHarness({
      state: { profileSeenUp: true },
      engineDeadMs: 150,
      findProcess: async () => ({ pid: 9, cmdline: 'dsh --profile dsh-lark' }),
    });
    const heartbeat = startHeartbeat(harness.heartbeatFile, 9, 20);
    try {
      await harness.service.start();
      await sleep(60);
      // Fresh heartbeat + live process: silent.
      expect(harness.service.snapshot().mode).toBe('standby');
      heartbeat.stop();
      // Heartbeat goes stale and stays stale past engineDeadMs: the engine is
      // dead despite the live process, so the guardian takes over.
      await until(() => harness.service.snapshot().mode === 'takeover');
      expect(harness.service.snapshot().mode).toBe('takeover');
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
    expect(harness.service.snapshot().safeEngine).toBe('test');
    const enterReply = JSON.stringify(harness.sent.at(-1)?.input);
    expect(enterReply).toContain('安全模式已就绪');
    expect(enterReply).toContain('引擎：');

    await harness.handlers.message?.(
      message({ messageId: 'm2', content: 'which plugin looks broken?' }) as never,
    );
    expect(harness.prompts[0]).toContain('which plugin looks broken?');
    // The answer streams into the run card instead of a one-shot markdown.
    expect(harness.streamCalls.at(-1)?.options).toEqual({ replyTo: 'm2' });
    expect(JSON.stringify(harness.streamed.at(-1))).toContain('fake answer');
    expect(JSON.stringify(harness.streamed.at(-1))).toContain('已完成');

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

  it('replies that a safe task is busy while another one is running', async () => {
    const hang = makeHangingAdapter();
    const harness = await makeHarness({
      state: { profileSeenUp: true },
      adapter: hang.adapter,
    });
    await harness.service.start();
    await until(() => harness.handlers.message !== undefined);
    await harness.handlers.message?.(message({ content: '/safemode' }) as never);

    const first = harness.handlers.message?.(
      message({ messageId: 'm2', content: 'first task' }) as never,
    );
    await until(() => harness.streamed.length > 1);
    await harness.handlers.message?.(
      message({ messageId: 'm3', content: 'second task' }) as never,
    );
    expect(JSON.stringify(harness.sent.at(-1)?.input)).toContain('仍在处理中');
    hang.release();
    await first;
  });

  it('stops a safe task that exceeds the run timeout and renders a timeout card', async () => {
    const hang = makeHangingAdapter();
    const harness = await makeHarness({
      state: { profileSeenUp: true },
      adapter: hang.adapter,
      safeTimeoutMs: 60,
    });
    await harness.service.start();
    await until(() => harness.handlers.message !== undefined);
    await harness.handlers.message?.(message({ content: '/safemode' }) as never);
    await harness.handlers.message?.(
      message({ messageId: 'm2', content: 'slow task' }) as never,
    );
    await until(() => JSON.stringify(harness.streamed.at(-1)).includes('已超时'));
    expect(hang.stopCalls()).toBeGreaterThan(0);
    expect(harness.service.snapshot().safeRuns).toBe(0);
  });

  it('keeps a safe task alive while events keep streaming past the timeout', async () => {
    let stopCalls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const adapter: AgentAdapter = {
      id: 'fake-stream',
      displayName: 'Fake Stream',
      async isAvailable() {
        return true;
      },
      async checkAvailability(): Promise<AgentAvailability> {
        return { ok: true, error: undefined, version: 'test' };
      },
      run(options: AgentRunOptions): AgentRun {
        return {
          runId: options.runId,
          events: (async function* () {
            // Stream activity for several timeout windows: the idle watchdog
            // must keep re-arming instead of killing an active task.
            const untilMs = Date.now() + 120;
            while (Date.now() < untilMs) {
              yield { type: 'text', delta: 'streaming…' };
              await new Promise((resolve) => setTimeout(resolve, 5));
            }
            await gate;
            yield { type: 'final_text', content: 'done' };
            yield { type: 'done', sessionId: undefined, terminationReason: 'normal' };
          })(),
          stop: async () => {
            stopCalls += 1;
            release();
          },
          waitForExit: async () => true,
        };
      },
    };
    const harness = await makeHarness({
      state: { profileSeenUp: true },
      adapter,
      safeTimeoutMs: 40,
    });
    await harness.service.start();
    await until(() => harness.handlers.message !== undefined);
    await harness.handlers.message?.(message({ content: '/safemode' }) as never);
    const task = harness.handlers.message?.(
      message({ messageId: 'm2', content: 'long task' }) as never,
    );
    await until(() => harness.streamed.length > 2);

    // Still streaming well past several 40 ms timeout windows: the watchdog
    // must not have fired.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(stopCalls).toBe(0);
    expect(JSON.stringify(harness.streamed.at(-1))).not.toContain('已超时');

    release();
    await task;
    expect(stopCalls).toBe(0);
    expect(harness.service.snapshot().safeRuns).toBe(0);
  });

  it('stops a running safe task from the card stop button', async () => {
    const hang = makeHangingAdapter();
    const harness = await makeHarness({
      state: { profileSeenUp: true },
      adapter: hang.adapter,
    });
    await harness.service.start();
    await until(() => harness.handlers.message !== undefined);
    await harness.handlers.message?.(message({ content: '/safemode' }) as never);
    const first = harness.handlers.message?.(
      message({ messageId: 'm2', content: 'long task' }) as never,
    );
    await until(() => harness.streamed.length > 1);
    await harness.handlers.cardAction?.({
      messageId: 'card-1',
      chatId: 'chat-1',
      operator: { openId: 'ou_admin' },
      action: { value: { cmd: 'stop' }, tag: 'button' },
    } as never);
    expect(hang.stopCalls()).toBeGreaterThan(0);
    hang.release();
    await first;
  });

  it('interrupts the active safe task via /safemode stop', async () => {
    const hang = makeHangingAdapter();
    const harness = await makeHarness({
      state: { profileSeenUp: true },
      adapter: hang.adapter,
    });
    await harness.service.start();
    await until(() => harness.handlers.message !== undefined);
    await harness.handlers.message?.(message({ content: '/safemode' }) as never);
    const first = harness.handlers.message?.(
      message({ messageId: 'm2', content: 'long task' }) as never,
    );
    await until(() => harness.streamed.length > 1);
    await harness.handlers.message?.(
      message({ messageId: 'm3', content: '/safemode stop' }) as never,
    );
    expect(hang.stopCalls()).toBeGreaterThan(0);
    expect(JSON.stringify(harness.sent.at(-1)?.input)).toContain('已请求终止');
    hang.release();
    await first;
  });

  it('falls back to headless when the safe SDK runtime cannot be provisioned', async () => {
    const harness = await makeHarness({
      state: { profileSeenUp: true },
      noAdapter: true,
      ensureSdkProfile: async () => ({
        ok: false,
        created: false,
        error: 'pnpm missing',
      }),
    });
    await harness.service.start();
    await until(() => harness.handlers.message !== undefined);
    await harness.handlers.message?.(message({ content: '/safemode' }) as never);
    expect(harness.service.snapshot().mode).toBe('safe');
    expect(harness.service.snapshot().safeEngine).toBe('headless');
    expect(JSON.stringify(harness.sent.at(-1)?.input)).toContain('headless 回退引擎');
  });

  it('refuses to enter safe mode when sdk is forced and unavailable', async () => {
    const harness = await makeHarness({
      state: { profileSeenUp: true },
      noAdapter: true,
      safeAdapterMode: 'sdk',
      ensureSdkProfile: async () => ({
        ok: false,
        created: false,
        error: 'no pnpm',
      }),
    });
    await harness.service.start();
    await until(() => harness.handlers.message !== undefined);
    await harness.handlers.message?.(message({ content: '/safemode' }) as never);
    expect(harness.service.snapshot().mode).not.toBe('safe');
    expect(JSON.stringify(harness.sent.at(-1)?.input)).toContain('引擎不可用');
  });

  it('re-provisions the engine when safe mode survived a guardian restart', async () => {
    const harness = await makeHarness({
      state: { profileSeenUp: true, mode: 'safe' },
      noAdapter: true,
      ensureSdkProfile: async () => ({
        ok: false,
        created: false,
        error: 'pnpm missing',
      }),
    });
    await harness.service.start();
    await until(() => harness.handlers.message !== undefined);
    await harness.handlers.message?.(message({ content: '/safemode' }) as never);
    expect(harness.service.snapshot().mode).toBe('safe');
    expect(harness.service.snapshot().safeEngine).toBe('headless');
    expect(JSON.stringify(harness.sent.at(-1)?.input)).toContain('安全模式已就绪');
  });
});
