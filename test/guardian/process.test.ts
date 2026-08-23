import { describe, expect, it, vi } from 'vitest';
import {
  captureOutput,
  findGuardianProcess,
  isProcessAlive,
  matchGuardianProcess,
  matchProfileProcess,
  spawnDetached,
} from '../../src/guardian/process.js';

describe('guardian process watch', () => {
  it('resolves and verifies the Linux systemd resident PID', async () => {
    const run = vi.fn(async (command: string) => {
      if (command === 'systemctl') return { code: 0, stdout: '4242\n', stderr: '' };
      return {
        code: 0,
        stdout: ' 4242 node /home/u/node_modules/dsh-lark-bot/dist/cli.js guardian run\n',
        stderr: '',
      };
    });

    await expect(findGuardianProcess({
      platform: 'linux',
      currentPid: 9000,
      run,
      isAlive: () => true,
    })).resolves.toEqual(expect.objectContaining({ pid: 4242 }));
    expect(run).toHaveBeenCalledWith(
      'systemctl',
      ['--user', 'show', 'dsh-lark-guardian.service', '--property=MainPID', '--value'],
      10_000,
    );
  });

  it('resolves and verifies the macOS launchd resident PID', async () => {
    const run = vi.fn(async (command: string) => {
      if (command === 'launchctl') {
        return { code: 0, stdout: 'io.dsh-lark.dsh-lark-guardian = {\n  pid = 5151\n}\n', stderr: '' };
      }
      return {
        code: 0,
        stdout: ' 5151 /opt/homebrew/bin/node /Users/u/dsh-lark-bot/dist/cli.js guardian run\n',
        stderr: '',
      };
    });

    await expect(findGuardianProcess({
      platform: 'darwin',
      currentPid: 9000,
      uid: 501,
      run,
      isAlive: () => true,
    })).resolves.toEqual(expect.objectContaining({ pid: 5151 }));
    expect(run).toHaveBeenCalledWith(
      'launchctl',
      ['print', 'gui/501/io.dsh-lark.dsh-lark-guardian'],
      10_000,
    );
  });

  it('resolves the unique Windows Startup guardian from CIM JSON', async () => {
    const cmdline = '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\u\\node_modules\\dsh-lark-bot\\dist\\cli.js" guardian run';
    const run = vi.fn(async () => ({
      code: 0,
      stdout: JSON.stringify([
        { ProcessId: 6262, CommandLine: cmdline },
        { ProcessId: 7000, CommandLine: null },
      ]),
      stderr: '',
    }));

    await expect(findGuardianProcess({
      platform: 'win32',
      currentPid: 9000,
      run,
      isAlive: () => true,
    })).resolves.toEqual({ pid: 6262, cmdline });
    expect(run).toHaveBeenCalledWith(
      'powershell.exe',
      expect.arrayContaining(['Get-CimInstance Win32_Process | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress']),
      10_000,
    );
  });

  it('fails closed when multiple resident guardian commands are alive', async () => {
    const run = vi.fn(async (command: string) => command === 'systemctl'
      ? { code: 0, stdout: '7001\n', stderr: '' }
      : {
          code: 0,
          stdout: [
            ' 7001 node /a/dsh-lark-bot/dist/cli.js guardian run',
            ' 7002 node /b/dsh-feishu-bot/dist/cli.js guardian run',
          ].join('\n'),
          stderr: '',
        });

    await expect(findGuardianProcess({
      platform: 'linux',
      currentPid: 9000,
      run,
      isAlive: () => true,
    })).resolves.toBeUndefined();
  });

  it('fails closed when the service manager PID disagrees with the process scan', async () => {
    const run = vi.fn(async (command: string) => command === 'systemctl'
      ? { code: 0, stdout: '7002\n', stderr: '' }
      : {
          code: 0,
          stdout: ' 7001 node /a/dsh-lark-bot/dist/cli.js guardian run\n',
          stderr: '',
        });

    await expect(findGuardianProcess({
      platform: 'linux',
      currentPid: 9000,
      run,
      isAlive: () => true,
    })).resolves.toBeUndefined();
  });

  it('fails closed when the verified candidate exits before it is returned', async () => {
    const run = vi.fn(async () => ({
      code: 0,
      stdout: ' 7001 node /a/dsh-lark-bot/dist/cli.js guardian run\n',
      stderr: '',
    }));
    const isAlive = vi.fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    await expect(findGuardianProcess({
      platform: 'freebsd',
      currentPid: 9000,
      run,
      isAlive,
    })).resolves.toBeUndefined();
    expect(isAlive).toHaveBeenCalledTimes(2);
  });

  it('never returns the querying process as the resident guardian', async () => {
    const run = vi.fn(async () => ({
      code: 0,
      stdout: ' 9000 node /a/dsh-lark-bot/dist/cli.js guardian run\n',
      stderr: '',
    }));

    await expect(findGuardianProcess({
      platform: 'freebsd',
      currentPid: 9000,
      run,
      isAlive: () => true,
    })).resolves.toBeUndefined();
  });

  it.each([
    'node /home/u/node_modules/dsh-lark-bot/dist/cli.js guardian run',
    '/opt/homebrew/bin/node /Users/u/dsh-lark-bot/dist/cli.js guardian run --dsh-profile dsh-lark',
    '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\u\\node_modules\\dsh-feishu-bot\\dist\\cli.js" guardian run',
  ])('matches the installed resident guardian command exactly: %s', (cmdline) => {
    expect(matchGuardianProcess(cmdline)).toBe(true);
  });

  it.each([
    'node /home/u/node_modules/dsh-lark-bot/dist/cli.js guardian status',
    'node /home/u/other/dist/cli.js guardian run',
    'node /home/u/node_modules/dsh-lark-bot/dist/cli.js guardian runner',
    'node -e "console.log(\\"guardian run\\")"',
  ])('rejects a non-resident guardian identity: %s', (cmdline) => {
    expect(matchGuardianProcess(cmdline)).toBe(false);
  });

  it('matches dsh profile processes without colliding with other profiles', () => {
    expect(matchProfileProcess('node /x/@deepseek-ai/dsh/lib/bin.js --profile dsh-lark', 'dsh-lark')).toBe(true);
    expect(matchProfileProcess('dsh --profile dsh-lark-safe run', 'dsh-lark')).toBe(false);
    expect(matchProfileProcess('dsh --profile=other', 'dsh-lark')).toBe(false);
    expect(matchProfileProcess('dsh --profile dsh-lark', 'dsh-lark')).toBe(true);
    expect(matchProfileProcess('node something.js --profile dsh-lark', 'dsh-lark')).toBe(false);
    expect(
      matchProfileProcess('node /x/@deepseek-ai/dsh/lib/bin.js plugin --profile dsh-lark add pkg', 'dsh-lark'),
    ).toBe(false);
    expect(matchProfileProcess('dsh plugin --profile dsh-lark add dsh-lark-bot', 'dsh-lark')).toBe(false);
  });

  it('matches dsh wrapper binaries by basename (e.g. ~/.local/bin/dsh)', () => {
    expect(matchProfileProcess('node /home/pluto/.local/bin/dsh --profile dsh-lark', 'dsh-lark')).toBe(true);
    expect(matchProfileProcess('node /usr/local/bin/dsh --profile dsh-lark', 'dsh-lark')).toBe(true);
    // A path that merely contains "dsh" as a prefix must not match.
    expect(matchProfileProcess('node /x/dsh-lark-helper --profile dsh-lark', 'dsh-lark')).toBe(false);
    // Token-level profile match still holds for wrappers.
    expect(matchProfileProcess('node /home/pluto/.local/bin/dsh --profile dsh-lark-safe', 'dsh-lark')).toBe(false);
  });

  it('captures command output', async () => {
    const result = await captureOutput('node', ['-e', 'console.log("ok")'], 5_000);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('ok');
  });

  it('checks process liveness for the current process', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(2_147_483_647)).toBe(false);
  });

  it('spawns detached processes', () => {
    const spawned = spawnDetached('node', ['-e', 'setTimeout(() => {}, 100)']);
    expect(typeof spawned.pid).toBe('number');
  });
});
