import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentAdapter, AgentRun } from '../src/adapters/types.js';
import { ConfigStore } from '../src/config/profile-store.js';
import { effectiveProfileModel } from '../src/cli/commands/run.js';
import {
  apply as applyBridgePlugin,
  Config as PluginConfig,
  LarkBridgeService,
} from '../src/plugin.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function makeCtx() {
  const provided: Record<string, unknown> = {};
  let settingsConsumer: ((ctx: unknown) => void | Promise<void>) | undefined;
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn() },
    reflect: {
      provide: (name: string, value: unknown) => {
        provided[name] = value;
        return () => {};
      },
    },
    inject: vi.fn((_deps: unknown, consumer: (ctx: unknown) => void | Promise<void>) => {
      settingsConsumer = consumer;
    }),
  };
  return {
    ctx,
    provided,
    async attachSettings(value?: Record<string, unknown>) {
      let current: Record<string, unknown> = value ?? {};
      let watcher: (() => void) | undefined;
      let registeredBase: Record<string, unknown> = {};
      await settingsConsumer?.({
        settings: {
          register: (_namespace: unknown, _schema: unknown, options: { base?: Record<string, unknown> }) => {
            registeredBase = options.base ?? {};
            if (value === undefined) current = registeredBase;
            return {
            get: () => current,
            watch: (next: () => void) => {
              watcher = next;
              return () => { watcher = undefined; };
            },
            };
          },
        },
        effect: vi.fn(),
      });
      return {
        base: registeredBase,
        update(next: Record<string, unknown>) {
          current = next;
          watcher?.();
        },
      };
    },
  };
}

function fakeAdapter(): AgentAdapter {
  const stop = vi.fn().mockResolvedValue(undefined);
  const adapter: AgentAdapter = {
    id: 'fake',
    displayName: 'Fake',
    async isAvailable() {
      return true;
    },
    async checkAvailability() {
      return { ok: true, error: undefined, version: 'fake' };
    },
    run(): AgentRun {
      return {
        runId: 'run-1',
        events: (async function* () {
          yield { type: 'done', sessionId: undefined, terminationReason: 'normal' };
        })(),
        stop,
        waitForExit: async () => true,
      };
    },
    dispose: vi.fn().mockResolvedValue(undefined),
  };
  return adapter;
}

function fakeChannel() {
  return {
    on: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    getBotIdentity: vi.fn().mockReturnValue({ openId: 'ou_default_bot', name: 'Default Bot' }),
    send: vi.fn().mockResolvedValue({ messageId: 'm1' }),
  };
}

describe('dsh-lark-bot bundle plugin', () => {
  it('lets a live Web model override the profile model captured at boot', () => {
    expect(effectiveProfileModel('deepseek-v4-pro', 'deepseek-v4-flash', 'fallback')).toBe('deepseek-v4-pro');
    expect(effectiveProfileModel(undefined, 'deepseek-v4-flash', 'fallback')).toBe('deepseek-v4-flash');
  });

  it('publishes a Web-settings schema with redacted credentials and bounded common options', () => {
    const schema = PluginConfig.toJSON() as unknown as {
      uid: number;
      refs: Record<string, { dict?: Record<string, number>; meta?: Record<string, unknown>; list?: number[]; value?: unknown }>;
    };
    const root = schema.refs[String(schema.uid)];
    const field = (name: string) => schema.refs[String(root?.dict?.[name])];
    expect(field('appSecret')?.meta?.role).toBe('secret');
    expect(field('workspace')?.meta?.description).toContain('项目文件夹');
    expect(field('scopeConcurrency')?.meta?.min).toBe(1);
    expect(field('scopeConcurrency')?.meta?.max).toBe(32);
    expect(field('notificationDefault')?.list?.map((id) => schema.refs[String(id)]?.value)).toEqual([
      'off',
      'completed',
      'all',
    ]);
  });

  it('starts the bridge engine in-process and registers the larkBridge service', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-'));
    tempDirs.push(root);
    const { ctx, provided } = makeCtx();
    const adapter = fakeAdapter();
    const channel = fakeChannel();
    const createChannel = vi.fn().mockReturnValue(channel);

    const dispose = applyBridgePlugin(
      ctx as never,
      {
        profile: 'default',
        home: root,
        appId: 'cli_test',
        appSecret: 'secret',
        tenant: 'feishu',
      },
      { env: {}, adapter, createChannel: createChannel as never },
    );

    expect(provided.larkBridge).toBeInstanceOf(LarkBridgeService);
    const service = provided.larkBridge as LarkBridgeService;
    await vi.waitFor(() => {
      expect(service.status().state).toBe('running');
    });
    expect(createChannel).toHaveBeenCalled();
    expect(adapter.dispose).not.toHaveBeenCalled();

    await dispose();
    expect(channel.disconnect).toHaveBeenCalled();
    expect(service.status().state).toBe('stopped');
  });

  it('stays stopped when disabled', () => {
    const { ctx, provided } = makeCtx();
    applyBridgePlugin(ctx as never, { profile: 'default', disabled: true }, { env: {} });
    const service = provided.larkBridge as LarkBridgeService;
    expect(service.status().state).toBe('stopped');
  });

  it('reloads the bridge when dsh Web commits a settings change', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-settings-'));
    tempDirs.push(root);
    const { ctx, provided, attachSettings } = makeCtx();
    const adapter = fakeAdapter();
    const channels = [fakeChannel(), fakeChannel()];
    const createChannel = vi.fn()
      .mockReturnValueOnce(channels[0])
      .mockReturnValueOnce(channels[1]);
    const base = {
      profile: 'default', home: root, appId: 'cli_old', appSecret: 'secret', tenant: 'feishu' as const,
    };
    const dispose = applyBridgePlugin(
      ctx as never,
      base,
      { env: {}, adapter, createChannel: createChannel as never },
    );
    const service = provided.larkBridge as LarkBridgeService;
    await vi.waitFor(() => expect(service.status().state).toBe('running'));

    await attachSettings({ ...base, appId: 'cli_new', scopeConcurrency: 4 });
    await vi.waitFor(() => expect(createChannel).toHaveBeenCalledTimes(2));
    expect(createChannel.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ appId: 'cli_new' }));

    await dispose();
  });

  it('applies safe next-task settings without disconnecting active bridge work', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-safe-settings-'));
    tempDirs.push(root);
    const { ctx, provided, attachSettings } = makeCtx();
    const adapter = fakeAdapter();
    const channel = fakeChannel();
    const createChannel = vi.fn(() => channel);
    const base = {
      profile: 'default', home: root, appId: 'cli_safe', appSecret: 'secret', tenant: 'feishu' as const,
    };
    const dispose = applyBridgePlugin(
      ctx as never,
      base,
      { env: {}, adapter, createChannel: createChannel as never },
    );
    const service = provided.larkBridge as LarkBridgeService;
    await vi.waitFor(() => expect(service.status().state).toBe('running'));

    await attachSettings({
      ...base,
      model: 'deepseek-v4-flash',
      scopeConcurrency: 4,
      notificationDefault: 'completed',
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(createChannel).toHaveBeenCalledOnce();
    expect(channel.disconnect).not.toHaveBeenCalled();
    expect(adapter.dispose).not.toHaveBeenCalled();

    await dispose();
  });

  it('hydrates the Web settings base from scan-bound profile values', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-profile-settings-'));
    tempDirs.push(root);
    const store = new ConfigStore(join(root, 'config.json'));
    await store.load();
    await store.saveProfile('default', {
      tenant: 'lark',
      appId: 'cli_scan_bound',
      appSecret: 'stored-secret',
      workspace: join(root, 'project'),
      model: 'deepseek-v4-pro',
    });
    const { ctx, provided, attachSettings } = makeCtx();
    const dispose = applyBridgePlugin(
      ctx as never,
      { profile: 'default', home: root },
      { env: {}, adapter: fakeAdapter(), createChannel: vi.fn(() => fakeChannel()) as never },
    );
    const service = provided.larkBridge as LarkBridgeService;
    await vi.waitFor(() => expect(service.status().state).toBe('running'));
    const settings = await attachSettings();
    expect(settings.base).toEqual(expect.objectContaining({
      tenant: 'lark',
      appId: 'cli_scan_bound',
      appSecret: 'stored-secret',
      workspace: join(root, 'project'),
      model: 'deepseek-v4-pro',
    }));
    await dispose();
  });

  it('stops an engine that finishes starting after plugin deactivation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-start-race-'));
    tempDirs.push(root);
    const { ctx, provided } = makeCtx();
    const adapter = fakeAdapter();
    let releaseConnect!: () => void;
    const pendingConnect = new Promise<void>((resolve) => { releaseConnect = resolve; });
    const channel = { ...fakeChannel(), connect: vi.fn(() => pendingConnect) };
    const dispose = applyBridgePlugin(
      ctx as never,
      { profile: 'default', home: root, appId: 'cli_test', appSecret: 'secret', tenant: 'feishu' },
      { env: {}, adapter, createChannel: vi.fn(() => channel) as never },
    );
    const service = provided.larkBridge as LarkBridgeService;
    await vi.waitFor(() => expect(channel.connect).toHaveBeenCalledOnce());
    const stopping = dispose();
    releaseConnect();
    await stopping;
    expect(channel.disconnect).toHaveBeenCalledOnce();
    expect(service.status().state).toBe('stopped');
    expect(adapter.dispose).toHaveBeenCalledOnce();
  });
});
