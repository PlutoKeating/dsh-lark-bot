import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildLaunchdPlist, LaunchdServiceController } from '../../src/service/macos-launchd.js';
import type { CommandRunner, ServiceSpec } from '../../src/service/types.js';

function makeSpec(): ServiceSpec {
  return {
    serviceName: 'dsh-lark-bot',
    label: 'io.dsh-lark-bot',
    profile: 'default',
    nodePath: '/usr/local/bin/node',
    cliJsPath: '/usr/local/lib/node_modules/dsh-lark-bot/dist/cli.js',
    envFile: '/Users/me/.dsh-lark/service/service.env',
    logFile: '/Users/me/.dsh-lark/profiles/default/logs/bot.log',
    env: { DEEPSEEK_API_KEY: 'sk-secret', PATH: '/usr/local/bin' },
  };
}

function fakeRunner(
  handler: (command: string, args: readonly string[]) => { code: number; stdout?: string },
): { run: CommandRunner; calls: Array<{ command: string; args: string[] }> } {
  const calls: Array<{ command: string; args: string[] }> = [];
  const run: CommandRunner = async (command, args) => {
    calls.push({ command, args: [...args] });
    const result = handler(command, args);
    return { code: result.code, stdout: result.stdout ?? '', stderr: '' };
  };
  return { run, calls };
}

describe('buildLaunchdPlist', () => {
  it('renders a LaunchAgent with KeepAlive, RunAtLoad and environment', () => {
    const plist = buildLaunchdPlist(makeSpec());
    expect(plist).toContain('<key>Label</key>');
    expect(plist).toContain('<string>io.dsh-lark-bot</string>');
    expect(plist).toContain('<key>RunAtLoad</key>');
    expect(plist).toContain('<true/>');
    expect(plist).toContain('<key>KeepAlive</key>');
    expect(plist).toContain('<key>EnvironmentVariables</key>');
    expect(plist).toContain('<key>DEEPSEEK_API_KEY</key>');
    expect(plist).toContain('<string>sk-secret</string>');
    expect(plist).toContain('<key>StandardOutPath</key>');
    expect(plist).toContain('/Users/me/.dsh-lark/profiles/default/logs/bot.log');
  });

  it('escapes XML special characters', () => {
    const plist = buildLaunchdPlist(
      {
        ...makeSpec(),
        label: 'io.dsh-lark-bot.a&b',
        logFile: '/Users/me/a <b>/bot.log',
        env: { DSH_LARK_WORKSPACE: '/x & y' },
      },
    );
    expect(plist).toContain('io.dsh-lark-bot.a&amp;b');
    expect(plist).toContain('/Users/me/a &lt;b&gt;/bot.log');
    expect(plist).toContain('/x &amp; y');
  });
});

describe('LaunchdServiceController', () => {
  it('bootstraps the agent and falls back to kickstart when already loaded', async () => {
    const { run, calls } = fakeRunner((command, args) => {
      if (command === 'launchctl' && args[0] === 'bootstrap') return { code: 113 };
      return { code: 0 };
    });
    const controller = new LaunchdServiceController({
      runCommand: run,
      launchAgentDir: '/tmp/agents',
      uid: 501,
    });

    await controller.installAndStart(makeSpec());

    expect(calls.map((call) => call.args.join(' '))).toContain(
      'bootstrap gui/501 /tmp/agents/io.dsh-lark-bot.plist',
    );
    expect(calls.map((call) => call.args.join(' '))).toContain(
      'kickstart -k gui/501/io.dsh-lark-bot',
    );
  });

  it('reports running status parsed from launchctl print output', async () => {
    const agentDir = await mkdtemp(join(tmpdir(), 'dsh-lark-agents-'));
    await writeFile(
      join(agentDir, 'io.dsh-lark-bot.plist'),
      buildLaunchdPlist(makeSpec()),
    );
    const { run } = fakeRunner((command, args) => {
      if (command === 'launchctl' && args[0] === 'print') {
        return { code: 0, stdout: 'state = running\npid = 777' };
      }
      return { code: 0 };
    });
    const controller = new LaunchdServiceController({
      runCommand: run,
      launchAgentDir: agentDir,
      uid: 501,
    });

    try {
      const status = await controller.status(makeSpec());
      expect(status.state).toBe('running');
      expect(status.pid).toBe(777);
      expect(status.autostartEnabled).toBe(true);
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
  });

  it('stops by booting out the agent and removing the plist', async () => {
    const agentDir = await mkdtemp(join(tmpdir(), 'dsh-lark-agents-'));
    await writeFile(
      join(agentDir, 'io.dsh-lark-bot.plist'),
      buildLaunchdPlist(makeSpec()),
    );
    const { run, calls } = fakeRunner(() => ({ code: 0 }));
    const controller = new LaunchdServiceController({
      runCommand: run,
      launchAgentDir: agentDir,
      uid: 501,
    });

    try {
      await controller.stop(makeSpec());
      expect(calls.map((call) => call.args.join(' '))).toContain(
        'bootout gui/501/io.dsh-lark-bot',
      );
      await expect(
        import('node:fs/promises').then((fs) => fs.stat(join(agentDir, 'io.dsh-lark-bot.plist'))),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
  });
});
