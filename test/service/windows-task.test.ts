import { describe, expect, it } from 'vitest';
import {
  buildScheduledTaskScript,
  parseTaskStatusOutput,
  WindowsTaskServiceController,
} from '../../src/service/windows-task.js';
import type { CommandRunner, ServiceSpec } from '../../src/service/types.js';

function makeSpec(): ServiceSpec {
  return {
    serviceName: 'dsh-lark-bot',
    label: 'io.dsh-lark-bot',
    profile: 'default',
    nodePath: 'C:\\Program Files\\nodejs\\node.exe',
    cliJsPath: 'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\dsh-lark-bot\\dist\\cli.js',
    envFile: 'C:\\Users\\me\\.dsh-lark\\service\\service.env',
    logFile: 'C:\\Users\\me\\.dsh-lark\\profiles\\default\\logs\\bot.log',
    env: { DEEPSEEK_API_KEY: 'sk-secret' },
  };
}

describe('buildScheduledTaskScript', () => {
  it('registers an at-logon task with restart-on-failure settings', () => {
    const script = buildScheduledTaskScript('install', makeSpec());
    expect(script).toContain("New-ScheduledTaskTrigger -AtLogOn");
    expect(script).toContain('-RestartCount 5');
    expect(script).toContain('-RestartInterval (New-TimeSpan -Minutes 1)');
    expect(script).toContain('-ExecutionTimeLimit ([TimeSpan]::Zero)');
    expect(script).toContain('run --profile');
    expect(script).toContain('Register-ScheduledTask');
    expect(script).toContain('Start-ScheduledTask');
  });

  it('stops and disables the task for stop semantics', () => {
    const script = buildScheduledTaskScript('stop', makeSpec());
    expect(script).toContain('Stop-ScheduledTask');
    expect(script).toContain('Disable-ScheduledTask');
    expect(script).not.toContain('Register-ScheduledTask');
  });
});

describe('parseTaskStatusOutput', () => {
  it('parses a running enabled task', () => {
    const parsed = parseTaskStatusOutput(
      ['STATE:Running', 'ENABLED:True', 'LAST_RESULT:0', 'LAST_RUN:2026-08-14'].join('\r\n'),
    );
    expect(parsed.state).toBe('running');
    expect(parsed.installed).toBe(true);
    expect(parsed.autostartEnabled).toBe(true);
  });

  it('parses a disabled (stopped) task', () => {
    const parsed = parseTaskStatusOutput('STATE:Disabled\nENABLED:False\nLAST_RESULT:0');
    expect(parsed.state).toBe('stopped');
    expect(parsed.autostartEnabled).toBe(false);
  });

  it('treats a missing task as not installed', () => {
    const parsed = parseTaskStatusOutput('STATE:missing\nENABLED:false');
    expect(parsed.installed).toBe(false);
    expect(parsed.state).toBe('stopped');
  });
});

describe('WindowsTaskServiceController', () => {
  it('runs the generated script through powershell and reports status', async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const run: CommandRunner = async (command, args) => {
      calls.push({ command, args: [...args] });
      if (args.some((arg) => arg.includes('status-'))) {
        return { code: 0, stdout: 'STATE:Running\nENABLED:True\nLAST_RESULT:0', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    };
    const controller = new WindowsTaskServiceController({
      runCommand: run,
      scriptDir: '/tmp/service',
    });

    await controller.installAndStart(makeSpec());
    const status = await controller.status(makeSpec());

    expect(calls.every((call) => call.command === 'powershell.exe')).toBe(true);
    expect(calls[0]?.args).toEqual(
      expect.arrayContaining(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File']),
    );
    expect(status.state).toBe('running');
    expect(status.autostartEnabled).toBe(true);
  });
});
