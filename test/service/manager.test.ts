import { mkdtemp, rm, readFile, stat, writeFile, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { resolveAppPaths } from '../../src/config/app-paths.js';
import { ServiceManager } from '../../src/service/manager.js';
import type {
  ServiceController,
  ServicePlatform,
  ServiceSpec,
  ServiceStatus,
} from '../../src/service/types.js';

class FakeController implements ServiceController {
  readonly platform: ServicePlatform = 'linux-systemd';
  calls: string[] = [];
  lastSpec: ServiceSpec | undefined;
  private state: ServiceStatus = {
    name: 'dsh-lark-bot',
    platform: this.platform,
    installed: false,
    autostartEnabled: false,
    state: 'stopped',
    detail: 'inactive',
    pid: undefined,
    restarts: undefined,
  };

  async installAndStart(spec: ServiceSpec): Promise<void> {
    this.lastSpec = spec;
    this.calls.push(`install:${spec.profile}`);
    this.state = {
      ...this.state,
      installed: true,
      autostartEnabled: true,
      state: 'running',
      detail: 'active',
    };
  }

  async start(spec: ServiceSpec): Promise<void> {
    this.calls.push(`start:${spec.profile}`);
    this.state = { ...this.state, state: 'running', detail: 'active' };
  }

  async stop(spec: ServiceSpec): Promise<void> {
    this.calls.push(`stop:${spec.profile}`);
    this.state = { ...this.state, state: 'stopped', detail: 'inactive' };
  }

  async restart(spec: ServiceSpec): Promise<void> {
    this.calls.push(`restart:${spec.profile}`);
    this.state = { ...this.state, state: 'running', detail: 'active' };
  }

  async uninstall(spec: ServiceSpec): Promise<void> {
    this.calls.push(`uninstall:${spec.profile}`);
    this.state = {
      ...this.state,
      installed: false,
      autostartEnabled: false,
      state: 'stopped',
      detail: 'missing',
    };
  }

  async status(): Promise<ServiceStatus> {
    this.calls.push('status');
    return this.state;
  }
}

describe('ServiceManager', () => {
  it('install writes the env snapshot and delegates to the controller', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-manager-'));
    const controller = new FakeController();
    const manager = new ServiceManager({
      profile: 'default',
      paths: resolveAppPaths(root),
      version: '0.4.0',
      env: { DEEPSEEK_API_KEY: 'sk-secret', DSH_LARK_ADAPTER: 'sdk' },
      controller,
      dshBin: '/opt/dsh.js',
    });

    try {
      const status = await manager.install();
      expect(status.state).toBe('running');
      expect(controller.calls).toContain('install:default');
      expect(controller.lastSpec?.commandArgs).toEqual([
        expect.stringContaining('dist/cli.js'),
        'service-run',
        '--profile',
        'default',
        '--env-file',
        join(root, 'service', 'default.env'),
      ]);
      const envFile = await readFile(join(root, 'service', 'default.env'), 'utf8');
      expect(envFile).toContain('DEEPSEEK_API_KEY="sk-secret"');
      const metadata = JSON.parse(
        await readFile(join(root, 'service', 'default.json'), 'utf8'),
      ) as { profile: string; platform: string; version: string };
      expect(metadata).toMatchObject({
        profile: 'default',
        platform: 'linux-systemd',
        version: '0.4.0',
      });
      expect((await stat(join(root, 'service', 'default.json'))).mode & 0o777).toBe(0o600);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('snapshots credentialRef keys declared by configured providers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-manager-'));
    const manager = new ServiceManager({
      profile: 'default',
      paths: resolveAppPaths(root),
      env: { CUSTOM_GATEWAY_TOKEN: 'provider-secret', UNRELATED: 'ignored' },
      controller: new FakeController(),
      dshBin: '/opt/dsh.js',
      providerManager: {
        listProviders: async () => [{ credentialRef: 'CUSTOM_GATEWAY_TOKEN' }] as never,
      },
    });
    try {
      await manager.install();
      const envFile = await readFile(join(root, 'service', 'default.env'), 'utf8');
      expect(envFile).toContain('CUSTOM_GATEWAY_TOKEN="provider-secret"');
      expect(envFile).not.toContain('UNRELATED');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('can uninstall a stale service after the dsh runtime has disappeared', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-manager-'));
    const controller = new FakeController();
    await mkdir(join(root, 'service'), { recursive: true });
    await writeFile(join(root, 'service', 'dsh-lark.json'), JSON.stringify({
      schemaVersion: 2,
      serviceName: 'dsh-lark-engine-dsh-lark',
      profile: 'dsh-lark',
      platform: 'linux-systemd',
      version: '0.4.0',
      installedAt: new Date().toISOString(),
      dshBin: '/removed/dsh.js',
    }));
    await writeFile(join(root, 'service', 'dsh-lark.env'), 'TOKEN="secret"\n');
    const manager = new ServiceManager({
      paths: resolveAppPaths(root),
      controller,
      env: {},
    });
    try {
      await manager.uninstall();
      expect(controller.calls).toContain('uninstall:dsh-lark');
      expect(await manager.readMetadata()).toBeUndefined();
      expect(await manager.readIntent()).toMatchObject({ desiredState: 'stopped' });
      await expect(access(join(root, 'service', 'dsh-lark.env'))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('restart refuses when the service is not installed yet', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-manager-'));
    const manager = new ServiceManager({
      paths: resolveAppPaths(root),
      controller: new FakeController(),
      dshBin: '/opt/dsh.js',
    });
    try {
      await expect(manager.restart()).rejects.toThrow(/service install/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('stop delegates to the controller', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-manager-'));
    const controller = new FakeController();
    const manager = new ServiceManager({
      paths: resolveAppPaths(root),
      controller,
      dshBin: '/opt/dsh.js',
    });
    try {
      await manager.install();
      const originalStop = controller.stop.bind(controller);
      controller.stop = vi.fn().mockImplementation(async (spec: ServiceSpec) => {
        expect(await manager.readIntent()).toMatchObject({ desiredState: 'stopped' });
        await originalStop(spec);
      });
      const status = await manager.stop();
      expect(status.state).toBe('stopped');
      expect(controller.calls).toContain('stop:dsh-lark');
      expect(await manager.readIntent()).toMatchObject({ desiredState: 'stopped' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses to install over an unmanaged foreground profile process', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-manager-'));
    const manager = new ServiceManager({
      paths: resolveAppPaths(root),
      controller: new FakeController(),
      dshBin: '/opt/dsh.js',
      findProcess: async () => ({ pid: 4242, cmdline: 'dsh --profile dsh-lark' }),
    });
    try {
      await expect(manager.install()).rejects.toThrow(/pid 4242/);
      expect(await manager.readMetadata()).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('serializes concurrent lifecycle mutations with a profile lock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-manager-'));
    const controller = new FakeController();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    controller.installAndStart = vi.fn().mockImplementation(async () => blocked);
    const manager = new ServiceManager({
      paths: resolveAppPaths(root),
      controller,
      dshBin: '/opt/dsh.js',
    });
    try {
      const first = manager.install();
      while (!(controller.installAndStart as ReturnType<typeof vi.fn>).mock.calls.length) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      await expect(manager.install()).rejects.toThrow(/生命周期操作正在执行/);
      release();
      await first;
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('cannot race an intent-aware guardian restart past an in-flight stop', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-manager-'));
    const controller = new FakeController();
    const manager = new ServiceManager({
      paths: resolveAppPaths(root),
      controller,
      dshBin: '/opt/dsh.js',
    });
    let entered!: () => void;
    let release!: () => void;
    const stopEntered = new Promise<void>((resolve) => { entered = resolve; });
    const stopBlocked = new Promise<void>((resolve) => { release = resolve; });
    try {
      await manager.install();
      const originalStop = controller.stop.bind(controller);
      controller.stop = vi.fn().mockImplementation(async (spec: ServiceSpec) => {
        entered();
        await stopBlocked;
        await originalStop(spec);
      });
      const stopping = manager.stop();
      await stopEntered;
      await expect(manager.restartManaged()).rejects.toThrow(/生命周期操作正在执行/);
      release();
      await stopping;
      expect(await manager.readIntent()).toMatchObject({ desiredState: 'stopped' });
      expect(controller.calls).not.toContain('restart:dsh-lark');
    } finally {
      release?.();
      await rm(root, { recursive: true, force: true });
    }
  });
});
