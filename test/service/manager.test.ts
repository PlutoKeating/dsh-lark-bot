import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
    this.calls.push(`install:${spec.profile}`);
    this.state = {
      ...this.state,
      installed: true,
      autostartEnabled: true,
      state: 'running',
      detail: 'active',
    };
  }

  async stop(spec: ServiceSpec): Promise<void> {
    this.calls.push(`stop:${spec.profile}`);
    this.state = { ...this.state, autostartEnabled: false, state: 'stopped', detail: 'inactive' };
  }

  async restart(spec: ServiceSpec): Promise<void> {
    this.calls.push(`restart:${spec.profile}`);
    this.state = { ...this.state, state: 'running', detail: 'active' };
  }

  async status(): Promise<ServiceStatus> {
    this.calls.push('status');
    return this.state;
  }
}

describe('ServiceManager', () => {
  it('start writes the env snapshot and delegates to the controller', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-manager-'));
    const controller = new FakeController();
    const manager = new ServiceManager({
      profile: 'default',
      paths: resolveAppPaths(root),
      version: '0.4.0',
      env: { DEEPSEEK_API_KEY: 'sk-secret', DSH_LARK_ADAPTER: 'sdk' },
      controller,
    });

    try {
      const status = await manager.start();
      expect(status.state).toBe('running');
      expect(controller.calls[0]).toBe('install:default');
      const envFile = await readFile(join(root, 'service', 'service.env'), 'utf8');
      expect(envFile).toContain('DEEPSEEK_API_KEY="sk-secret"');
      const metadata = JSON.parse(
        await readFile(join(root, 'service', 'service.json'), 'utf8'),
      ) as { profile: string; platform: string; version: string };
      expect(metadata).toMatchObject({
        profile: 'default',
        platform: 'linux-systemd',
        version: '0.4.0',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('restart refuses when the service is not installed yet', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-manager-'));
    const manager = new ServiceManager({
      paths: resolveAppPaths(root),
      controller: new FakeController(),
    });
    try {
      await expect(manager.restart()).rejects.toThrow(/请先运行 dsh-lark-bot start/);
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
    });
    try {
      await manager.start();
      const status = await manager.stop();
      expect(status.state).toBe('stopped');
      expect(controller.calls).toContain('stop:default');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
