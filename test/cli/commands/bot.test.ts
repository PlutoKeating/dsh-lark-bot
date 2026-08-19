import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runBotCommand } from '../../../src/cli/commands/bot.js';
import type { ServiceStatus } from '../../../src/service/types.js';
import { DshProviderManager } from '../../../src/config/dsh-config.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const running = (name: string): ServiceStatus => ({
  name, platform: 'linux-systemd', installed: true, autostartEnabled: true,
  state: 'running', detail: 'running', pid: undefined, restarts: undefined,
});

describe('bot instance commands', () => {
  it('rejects shared Web adapter mode for additional instances', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-bot-web-'));
    roots.push(root);
    await expect(runBotCommand('add', { name: 'reviewer' }, {
      env: { DSH_LARK_HOME: root, DSH_LARK_ADAPTER: 'web' },
    })).rejects.toThrow('不支持共享 Web adapter');
  });

  it('does not let fleet lifecycle remove the existing primary bot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-bot-primary-'));
    roots.push(root);
    await expect(runBotCommand('remove', { name: 'default' }, {
      env: { DSH_LARK_HOME: root },
    })).rejects.toThrow('默认主机器人不能');
  });

  it('keeps provider credentials in independent per-instance DSH_HOME stores', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-bot-credentials-'));
    roots.push(root);
    const reviewer = new DshProviderManager({
      home: root, env: { DSH_HOME: join(root, 'bots', 'reviewer', 'dsh') },
    });
    const developer = new DshProviderManager({
      home: root, env: { DSH_HOME: join(root, 'bots', 'developer', 'dsh') },
    });
    await reviewer.setCredential('TEAM_API_KEY', 'reviewer-secret');
    await developer.setCredential('TEAM_API_KEY', 'developer-secret');

    expect(await reviewer.readCredentials()).toEqual({ TEAM_API_KEY: 'reviewer-secret' });
    expect(await developer.readCredentials()).toEqual({ TEAM_API_KEY: 'developer-secret' });
  });

  it('adds an isolated profile/service and removes only credentials while preserving data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-bot-command-'));
    roots.push(root);
    const output: string[] = [];
    const setup = vi.fn().mockResolvedValue(undefined);
    const install = vi.fn().mockResolvedValue(running('dsh-lark-reviewer'));
    const uninstall = vi.fn().mockResolvedValue({ ...running('dsh-lark-reviewer'), state: 'stopped' });
    const serviceEnvs: NodeJS.ProcessEnv[] = [];
    const serviceFor = vi.fn().mockImplementation((profile: string, env: NodeJS.ProcessEnv) => {
      serviceEnvs.push(env);
      return { install, uninstall, status: vi.fn().mockResolvedValue(running(profile)) };
    });
    const ensureProfile = vi.fn().mockImplementation(async (store, options) => {
      await store.saveProfile(options.profileName, {
        tenant: 'feishu', appId: 'cli_reviewer', appSecret: 'secret', model: 'gateway/reviewer',
      });
      return true;
    });
    const deps = {
      env: {
        DSH_LARK_HOME: root,
        DSH_LARK_APP_ID: 'cli_primary',
        DSH_LARK_APP_SECRET: 'primary-secret',
      }, output: (text: string) => output.push(text),
      setup, ensureProfile, serviceFor, waitForIdentity: vi.fn().mockResolvedValue(undefined),
    };

    await runBotCommand('add', { name: 'reviewer' }, deps);
    expect(setup).toHaveBeenCalledWith({
      profile: 'dsh-lark-reviewer', dshHome: join(root, 'bots', 'reviewer', 'dsh'), guardian: false,
    });
    expect(serviceEnvs[0]?.DSH_LARK_PROFILE).toBe('reviewer');
    expect(serviceEnvs[0]?.DSH_LARK_DSH_PROFILE).toBe('dsh-lark-reviewer');
    expect(serviceEnvs[0]?.DSH_HOME).toBe(join(root, 'bots', 'reviewer', 'dsh'));
    expect(serviceEnvs[0]?.DSH_LARK_APP_ID).toBeUndefined();
    expect(ensureProfile.mock.calls[0]?.[1].env.appId).toBeUndefined();
    expect(JSON.parse(await readFile(join(root, 'fleet.json'), 'utf8')).bots.reviewer).toMatchObject({
      bridgeProfile: 'reviewer', dshProfile: 'dsh-lark-reviewer', enabled: true,
    });
    await mkdir(join(root, 'profiles', 'reviewer', 'worktrees'), { recursive: true });
    await mkdir(join(root, 'bots', 'reviewer', 'dsh'), { recursive: true });
    await writeFile(join(root, 'bots', 'reviewer', 'dsh', '.credentials.yaml'), 'secret: value\n');

    await runBotCommand('remove', { name: 'reviewer' }, deps);
    expect(uninstall).toHaveBeenCalled();
    expect(JSON.parse(await readFile(join(root, 'config.json'), 'utf8')).profiles.reviewer).toBeUndefined();
    expect(JSON.parse(await readFile(join(root, 'fleet.json'), 'utf8')).bots.reviewer).toBeUndefined();
    await expect(readFile(join(root, 'bots', 'reviewer', 'dsh', '.credentials.yaml')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    expect(output.join('')).toContain('会话/工作树数据保留');
  });

  it('rolls back fleet registration and credentials when the service cannot start', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-bot-rollback-'));
    roots.push(root);
    const ensureProfile = vi.fn().mockImplementation(async (store, options) => {
      await store.saveProfile(options.profileName, {
        tenant: 'feishu', appId: 'cli_bad', appSecret: 'secret',
      });
      return true;
    });
    const uninstall = vi.fn().mockResolvedValue({ ...running('dsh-lark-broken'), state: 'stopped' });
    await expect(runBotCommand('add', { name: 'broken' }, {
      env: { DSH_LARK_HOME: root }, setup: vi.fn().mockResolvedValue(undefined), ensureProfile,
      waitForIdentity: vi.fn().mockResolvedValue(undefined),
      serviceFor: () => ({
        install: vi.fn().mockRejectedValue(new Error('service failed')),
        status: vi.fn(), uninstall,
      }),
    })).rejects.toThrow('已回滚凭据与 fleet 注册');
    expect(JSON.parse(await readFile(join(root, 'config.json'), 'utf8')).profiles.broken).toBeUndefined();
    expect(JSON.parse(await readFile(join(root, 'fleet.json'), 'utf8')).bots.broken).toBeUndefined();
    expect(uninstall).toHaveBeenCalled();
  });

  it('rolls back a running service that never reaches a unique identity-ready state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-bot-identity-failure-'));
    roots.push(root);
    const uninstall = vi.fn().mockResolvedValue({ ...running('dsh-lark-reviewer'), state: 'stopped' });
    const ensureProfile = vi.fn().mockImplementation(async (store, options) => {
      await store.saveProfile(options.profileName, {
        tenant: 'feishu', appId: 'cli_duplicate', appSecret: 'secret',
      });
      return true;
    });

    await expect(runBotCommand('add', { name: 'reviewer' }, {
      env: { DSH_LARK_HOME: root }, setup: vi.fn().mockResolvedValue(undefined), ensureProfile,
      serviceFor: () => ({
        install: vi.fn().mockResolvedValue(running('dsh-lark-reviewer')),
        status: vi.fn(), uninstall,
      }),
      waitForIdentity: vi.fn().mockRejectedValue(new Error('重复 bot open_id')),
    })).rejects.toThrow('已回滚凭据与 fleet 注册');

    expect(uninstall).toHaveBeenCalled();
    expect(JSON.parse(await readFile(join(root, 'fleet.json'), 'utf8')).bots.reviewer).toBeUndefined();
    expect(JSON.parse(await readFile(join(root, 'config.json'), 'utf8')).profiles.reviewer).toBeUndefined();
  });
});
