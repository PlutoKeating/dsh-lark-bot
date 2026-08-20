import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildSystemdUnit,
  SystemdServiceController,
} from '../../src/service/linux-systemd.js';
import type { CommandRunner, ServiceSpec } from '../../src/service/types.js';

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
    env: { PATH: '/usr/bin' },
    ...overrides,
  };
}

function fakeRunner(
  handler: (command: string, args: readonly string[]) => {
    code: number;
    stdout?: string;
    stderr?: string;
  },
): { run: CommandRunner; calls: Array<{ command: string; args: string[] }> } {
  const calls: Array<{ command: string; args: string[] }> = [];
  const run: CommandRunner = async (command, args) => {
    calls.push({ command, args: [...args] });
    const result = handler(command, args);
    return { code: result.code, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  };
  return { run, calls };
}

describe('buildSystemdUnit', () => {
  it('renders a user service with autostart and restart-on-failure', () => {
    const unit = buildSystemdUnit(makeSpec());
    expect(unit).toContain('[Unit]');
    expect(unit).toContain('WantedBy=default.target');
    expect(unit).toContain('Restart=always');
    expect(unit).toContain('RestartSec=5');
    expect(unit).toContain(
      'ExecStart=/usr/bin/node /opt/dsh.js --profile default',
    );
    expect(unit).toContain('EnvironmentFile=/home/user/.dsh-lark/service/service.env');
    expect(unit).toContain(
      'StandardOutput=append:/home/user/.dsh-lark/profiles/default/logs/bot.log',
    );
  });

  it('quotes executable arguments containing spaces', () => {
    const unit = buildSystemdUnit(
      makeSpec({
        commandPath: '/opt/node 22/bin/node',
        commandArgs: ['/home/user/my packages/dsh.js', '--profile', 'work bot'],
        profile: 'work bot',
      }),
    );
    expect(unit).toContain(
      'ExecStart="/opt/node 22/bin/node" "/home/user/my packages/dsh.js" --profile "work bot"',
    );
  });
});

describe('SystemdServiceController', () => {
  it('installs, enables and starts on first run', async () => {
    const { run, calls } = fakeRunner((command, args) => {
      if (command === 'systemctl' && args.includes('is-active')) return { code: 1 };
      return { code: 0 };
    });
    const controller = new SystemdServiceController({
      runCommand: run,
      userUnitDir: '/tmp/user-units',
    });

    await controller.installAndStart(makeSpec());

    const commands = calls.map((call) => `${call.command} ${call.args.join(' ')}`);
    expect(commands).toContain('systemctl --user daemon-reload');
    expect(commands).toContain('systemctl --user enable --now dsh-lark-bot.service');
  });

  it('restarts an already active service to apply refreshed env', async () => {
    const { run, calls } = fakeRunner((command, args) => {
      if (command === 'systemctl' && args.includes('is-active')) return { code: 0 };
      return { code: 0 };
    });
    const controller = new SystemdServiceController({
      runCommand: run,
      userUnitDir: '/tmp/user-units',
    });

    await controller.installAndStart(makeSpec());

    expect(calls.map((call) => call.args.join(' '))).toContain(
      '--user restart dsh-lark-bot.service',
    );
  });

  it('reports running status with pid and restart count', async () => {
    const { run } = fakeRunner((command, args) => {
      if (command === 'systemctl' && args.includes('is-active')) return { code: 0 };
      if (command === 'systemctl' && args.includes('is-enabled')) {
        return { code: 0, stdout: 'enabled' };
      }
      if (command === 'systemctl' && args.includes('show')) {
        // `systemctl show --value` prints properties alphabetically.
        return { code: 0, stdout: 'active\n4242\n3' };
      }
      return { code: 0 };
    });
    const unitDir = await mkdtemp(join(tmpdir(), 'dsh-lark-units-'));
    await writeFile(join(unitDir, 'dsh-lark-bot.service'), '[Unit]\n');
    const controller = new SystemdServiceController({
      runCommand: run,
      userUnitDir: unitDir,
    });
    try {
      const status = await controller.status(makeSpec());
      expect(status.state).toBe('running');
      expect(status.installed).toBe(true);
      expect(status.autostartEnabled).toBe(true);
      expect(status.pid).toBe(4242);
      expect(status.restarts).toBe(3);
    } finally {
      await rm(unitDir, { recursive: true, force: true });
    }
  });

  it('stops without removing autostart registration', async () => {
    const { run, calls } = fakeRunner(() => ({ code: 0 }));
    const controller = new SystemdServiceController({
      runCommand: run,
      userUnitDir: '/tmp/user-units',
    });

    await controller.stop(makeSpec());

    expect(calls.map((call) => call.args.join(' '))).toContain(
      '--user stop dsh-lark-bot.service',
    );
  });
});
