import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
      'Exec=/usr/bin/node /home/user/lib/node_modules/dsh-lark-bot/dist/cli.js supervise --profile default',
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
        return { unref: () => undefined } as never;
      },
    });

    try {
      await controller.installAndStart(makeSpec());
      expect(spawned).toEqual([
        {
          nodePath: '/usr/bin/node',
          args: [
            '/home/user/lib/node_modules/dsh-lark-bot/dist/cli.js',
            'supervise',
            '--profile',
            'default',
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
      } satisfies SupervisorStatus)}\n`,
    );
    const controller = new PortableServiceController({
      autostartDir: autostart,
      serviceDir,
      spawnDetached: () => ({ unref: () => undefined }) as never,
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
});
