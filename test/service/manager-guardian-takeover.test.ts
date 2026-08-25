import { mkdtemp, rm } from 'node:fs/promises';
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

// Control the process-observation helpers the manager imports so a
// guardian-spawned profile process can be simulated deterministically.
vi.mock('../../src/guardian/process.js', () => ({
  listProcesses: vi.fn(),
  matchGuardianProcess: vi.fn(),
  findProfileProcess: vi.fn(),
}));

// eslint-disable-next-line import/first
import { listProcesses, matchGuardianProcess } from '../../src/guardian/process.js';

class RecordingController implements ServiceController {
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
    this.state = { ...this.state, installed: true, autostartEnabled: true, state: 'running', detail: 'active' };
  }
  async start(spec: ServiceSpec): Promise<void> {
    this.calls.push(`start:${spec.profile}`);
  }
  async stop(spec: ServiceSpec): Promise<void> {
    this.calls.push(`stop:${spec.profile}`);
  }
  async restart(spec: ServiceSpec): Promise<void> {
    this.calls.push(`restart:${spec.profile}`);
  }
  async uninstall(spec: ServiceSpec): Promise<void> {
    this.calls.push(`uninstall:${spec.profile}`);
  }
  async status(): Promise<ServiceStatus> {
    this.calls.push('status');
    return this.state;
  }
}

describe('ServiceManager guardian takeover (issue #112 Bug D)', () => {
  it('stops a guardian-spawned profile process so install can take over', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-manager-'));
    const controller = new RecordingController();
    (listProcesses as ReturnType<typeof vi.fn>).mockResolvedValue([
      { pid: 777, cmdline: 'node /home/u/cli.js guardian run --dsh-profile dsh-lark' },
    ]);
    (matchGuardianProcess as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const manager = new ServiceManager({
      paths: resolveAppPaths(root),
      controller,
      dshBin: '/opt/dsh.js',
      findProcess: async () => ({ pid: 4242, ppid: 777, cmdline: 'dsh --profile dsh-lark' }),
      providerManager: { listProviders: async () => [] },
    });
    // The process is already gone (ESRCH), so the stop returns without waiting.
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
    });
    try {
      const status = await manager.install();
      expect(status.state).toBe('running');
      expect(controller.calls).toContain('install:dsh-lark');
      expect(killSpy).toHaveBeenCalledWith(4242, 'SIGTERM');
    } finally {
      killSpy.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('still refuses when the unmanaged process was not spawned by the guardian', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-manager-'));
    const controller = new RecordingController();
    (listProcesses as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (matchGuardianProcess as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const manager = new ServiceManager({
      paths: resolveAppPaths(root),
      controller,
      dshBin: '/opt/dsh.js',
      // No ppid -> not a guardian child -> must refuse.
      findProcess: async () => ({ pid: 4242, cmdline: 'dsh --profile dsh-lark' }),
      providerManager: { listProviders: async () => [] },
    });
    try {
      await expect(manager.install()).rejects.toThrow(/pid 4242/);
      expect(controller.calls).not.toContain('install:dsh-lark');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
