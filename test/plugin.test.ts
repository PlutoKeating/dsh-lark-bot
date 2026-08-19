import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentAdapter, AgentRun } from '../src/adapters/types.js';
import { apply as applyBridgePlugin, LarkBridgeService } from '../src/plugin.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function makeCtx() {
  const provided: Record<string, unknown> = {};
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn() },
    reflect: {
      provide: (name: string, value: unknown) => {
        provided[name] = value;
        return () => {};
      },
    },
  };
  return { ctx, provided };
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

    dispose();
    await vi.waitFor(() => {
      expect(channel.disconnect).toHaveBeenCalled();
    });
    await vi.waitFor(() => {
      expect(service.status().state).toBe('stopped');
    });
  });

  it('stays stopped when disabled', () => {
    const { ctx, provided } = makeCtx();
    applyBridgePlugin(ctx as never, { profile: 'default', disabled: true }, { env: {} });
    const service = provided.larkBridge as LarkBridgeService;
    expect(service.status().state).toBe('stopped');
  });
});
