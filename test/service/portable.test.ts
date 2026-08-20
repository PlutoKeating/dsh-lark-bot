import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  buildDesktopEntry,
  PortableServiceController,
  readSupervisorStatus,
  supervisorStatusFile,
  type SupervisorStatus,
} from '../../src/service/portable.js';
import type { ServiceSpec } from '../../src/service/types.js';

function makeSpec(overrides: Partial<ServiceSpec> = {}): ServiceSpec {
  return {
    serviceName: 'dsh-lark-bot',
    label: 'io.dsh-lark-bot',
    profile: 'default',
    nodePath: '/usr/bin/node',
    cliJsPath: '/home/user/lib/node_modules/dsh-lark-bot/dist/cli.js',
    dshBin: '/opt/dsh.js',
    commandPath: '/usr/bin/node',
    commandArgs: ['/opt/dsh.js', '--profile', 'default'],
    envFile: '/home/user/.dsh-lark/service/service.env',
    logFile: '/home/user/.dsh-lark/profiles/default/logs/bot.log',
    env: {},
    ...overrides,
  };
}

describe('buildDesktopEntry', () => {
  it('renders an XDG autostart entry pointing at the supervisor', () => {
    const entry = buildDesktopEntry(makeSpec());
    expect(entry).toContain('[Desktop Entry]');
    expect(entry).toContain('X-GNOME-Autostart-enabled=true');
    expect(entry).toContain(
      'Exec=/usr/bin/node /home/user/lib/node_modules/dsh-lark-bot/dist/cli.js service-supervise --profile default --env-file /home/user/.dsh-lark/service/service.env',
    );
  });
});

describe('readSupervisorStatus', () => {
  it('reads a status file written by the supervisor', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-lark-portable-'));
    const file = supervisorStatusFile(dir, 'dsh-lark-bot');
    const status: SupervisorStatus = {
      pid: 123,
      childPid: 456,
      state: 'running',
      startedAt: '2026-08-14T00:00:00.000Z',
      restarts: 2,
      profile: 'default',
    };
    await writeFile(file, `${JSON.stringify(status)}\n`);
    try {
      expect(await readSupervisorStatus(file)).toEqual(status);
      expect(await readSupervisorStatus(join(dir, 'missing.json'))).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('PortableServiceController', () => {
  it('writes autostart entry and spawns a detached supervisor on install', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-lark-portable-'));
    const autostart = join(dir, 'autostart');
    const serviceDir = join(dir, 'service');
    const spawned: Array<{ nodePath: string; args: string[] }> = [];
    const controller = new PortableServiceController({
      autostartDir: autostart,
      serviceDir,
      spawnDetached: (nodePath, args) => {
        spawned.push({ nodePath, args: [...args] });
        return { pid: 123, kill: vi.fn(), unref: () => undefined } as never;
      },
      processIdentity: async () => ({
        startTimeTicks: '1234',
        cmdline: 'node cli.js service-supervise --profile default',
      }),
    });

    try {
      await controller.installAndStart(makeSpec());
      expect(spawned).toEqual([
        {
          nodePath: '/usr/bin/node',
          args: [
            '/home/user/lib/node_modules/dsh-lark-bot/dist/cli.js',
            'service-supervise',
            '--profile',
            'default',
            '--env-file',
            '/home/user/.dsh-lark/service/service.env',
          ],
        },
      ]);
      const entry = await import('node:fs/promises').then((fs) =>
        fs.readFile(join(autostart, 'dsh-lark-bot.desktop'), 'utf8'),
      );
      expect(entry).toContain('X-GNOME-Autostart-enabled=true');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('removes the autostart entry when initial supervisor identity verification fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-lark-portable-'));
    const autostart = join(dir, 'autostart');
    const controller = new PortableServiceController({
      autostartDir: autostart,
      serviceDir: join(dir, 'service'),
      spawnDetached: () => ({ pid: 321, kill: vi.fn(), unref: () => undefined }) as never,
      processIdentity: async () => undefined,
    });
    try {
      await expect(controller.installAndStart(makeSpec())).rejects.toThrow(/无法验证进程身份/);
      await expect(import('node:fs/promises').then((fs) =>
        fs.access(join(autostart, 'dsh-lark-bot.desktop')),
      )).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reports running when the supervisor pid is alive', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-lark-portable-'));
    const autostart = join(dir, 'autostart');
    const serviceDir = join(dir, 'service');
    await import('node:fs/promises').then((fs) => fs.mkdir(autostart, { recursive: true }));
    await import('node:fs/promises').then((fs) => fs.mkdir(serviceDir, { recursive: true }));
    await writeFile(join(autostart, 'dsh-lark-bot.desktop'), buildDesktopEntry(makeSpec()));
    const statusFile = supervisorStatusFile(serviceDir, 'dsh-lark-bot');
    await writeFile(
      statusFile,
      `${JSON.stringify({
        pid: process.pid,
        childPid: process.pid,
        state: 'running',
        startedAt: '2026-08-14T00:00:00.000Z',
        restarts: 1,
        profile: 'default',
        processIdentity: {
          startTimeTicks: '100',
          cmdline: 'node cli.js service-supervise --profile default',
        },
      } satisfies SupervisorStatus)}\n`,
    );
    const controller = new PortableServiceController({
      autostartDir: autostart,
      serviceDir,
      spawnDetached: () => ({ unref: () => undefined }) as never,
      processIdentity: async () => ({
        startTimeTicks: '100',
        cmdline: 'node cli.js service-supervise --profile default',
      }),
    });

    try {
      const status = await controller.status(makeSpec());
      expect(status.state).toBe('running');
      expect(status.autostartEnabled).toBe(true);
      expect(status.restarts).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('never signals a reused pid whose process identity does not match', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-lark-portable-'));
    const serviceDir = join(dir, 'service');
    await import('node:fs/promises').then((fs) => fs.mkdir(serviceDir, { recursive: true }));
    await writeFile(
      supervisorStatusFile(serviceDir, 'dsh-lark-bot'),
      `${JSON.stringify({
        pid: 4242,
        childPid: 4243,
        state: 'running',
        startedAt: '2026-08-14T00:00:00.000Z',
        restarts: 1,
        profile: 'default',
        processIdentity: {
          startTimeTicks: 'old-start',
          cmdline: 'node cli.js service-supervise --profile default',
        },
      } satisfies SupervisorStatus)}\n`,
    );
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const controller = new PortableServiceController({
      autostartDir: join(dir, 'autostart'),
      serviceDir,
      processIdentity: async () => ({
        startTimeTicks: 'new-start',
        cmdline: 'unrelated-process',
      }),
    });
    try {
      await controller.stop(makeSpec());
      expect(kill).not.toHaveBeenCalled();
      expect(await readSupervisorStatus(
        supervisorStatusFile(serviceDir, 'dsh-lark-bot'),
      )).toBeUndefined();
    } finally {
      kill.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('kills the verified supervisor process group when graceful stop hangs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-lark-portable-'));
    const serviceDir = join(dir, 'service');
    await import('node:fs/promises').then((fs) => fs.mkdir(serviceDir, { recursive: true }));
    const identity = {
      startTimeTicks: 'same-start',
      cmdline: 'node cli.js service-supervise --profile default',
    };
    await writeFile(
      supervisorStatusFile(serviceDir, 'dsh-lark-bot'),
      `${JSON.stringify({
        pid: 4242,
        childPid: 4243,
        state: 'running',
        startedAt: '2026-08-14T00:00:00.000Z',
        restarts: 1,
        profile: 'default',
        processIdentity: identity,
      } satisfies SupervisorStatus)}\n`,
    );
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    let groupKilled = false;
    kill.mockImplementation((pid) => {
      if (pid === -4242) groupKilled = true;
      return true;
    });
    const controller = new PortableServiceController({
      autostartDir: join(dir, 'autostart'),
      serviceDir,
      processIdentity: async () => groupKilled ? undefined : identity,
      stopPollMs: 1,
      stopPollAttempts: 1,
    });
    try {
      await controller.stop(makeSpec());
      expect(kill).toHaveBeenCalledWith(4242, 'SIGTERM');
      expect(kill).toHaveBeenCalledWith(-4242, 'SIGKILL');
    } finally {
      kill.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
