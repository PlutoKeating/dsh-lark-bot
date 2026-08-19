import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { runCommand } from './command.js';
import type {
  CommandRunner,
  ServiceController,
  ServicePlatform,
  ServiceRuntimeState,
  ServiceSpec,
  ServiceStatus,
} from './types.js';

export interface WindowsTaskControllerOptions {
  runCommand?: CommandRunner;
  scriptDir?: string;
}

export type WindowsTaskAction = 'install' | 'start' | 'stop' | 'restart' | 'uninstall' | 'status';

export function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function buildScheduledTaskScript(
  action: WindowsTaskAction,
  spec: ServiceSpec,
): string {
  const vars = [
    `$taskName = ${psQuote(spec.serviceName)}`,
    `$command = ${psQuote(spec.commandPath)}`,
    `$arguments = ${psQuote(spec.commandArgs.map((arg) => `"${arg.replace(/"/g, '\\"')}"`).join(' '))}`,
    `$log = ${psQuote(spec.logFile)}`,
    `$profile = ${psQuote(spec.profile)}`,
    `$workDir = ${psQuote(dirname(spec.commandPath))}`,
  ].join('\n');

  const install = [
    `$inner = '"' + $command + '" ' + $arguments + ' >> "' + $log + '" 2>&1'`,
    `$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument ('/c ' + $inner) -WorkingDirectory $workDir`,
    `$trigger = New-ScheduledTaskTrigger -AtLogOn`,
    `$settings = New-ScheduledTaskSettingsSet -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries`,
    `Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue`,
    `Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force`,
    `Enable-ScheduledTask -TaskName $taskName`,
    `Start-ScheduledTask -TaskName $taskName`,
  ].join('\n');

  const stop = [
    `Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue`,
  ].join('\n');

  const start = [
    `Enable-ScheduledTask -TaskName $taskName`,
    `Start-ScheduledTask -TaskName $taskName`,
  ].join('\n');

  const uninstall = [
    `Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue`,
    `Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue`,
  ].join('\n');

  const restart = [
    `Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue`,
    `Start-ScheduledTask -TaskName $taskName`,
  ].join('\n');

  const status = [
    `$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue`,
    `if ($null -eq $task) { Write-Output 'STATE:missing'; Write-Output 'ENABLED:false'; exit 2 }`,
    `$info = Get-ScheduledTaskInfo -TaskName $taskName`,
    `Write-Output ('STATE:' + $task.State)`,
    `Write-Output ('ENABLED:' + $task.Settings.Enabled)`,
    `Write-Output ('LAST_RESULT:' + $info.LastTaskResult)`,
    `Write-Output ('LAST_RUN:' + $info.LastRunTime)`,
  ].join('\n');

  const body: Record<WindowsTaskAction, string> = {
    install,
    start,
    stop,
    restart,
    uninstall,
    status,
  };

  return [
    `$ErrorActionPreference = 'Stop'`,
    vars,
    body[action],
    '',
  ].join('\n');
}

export function parseTaskStatusOutput(output: string): {
  installed: boolean;
  autostartEnabled: boolean;
  state: ServiceRuntimeState;
  detail: string;
  lastResult: number | undefined;
} {
  const fields = new Map<string, string>();
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    const eq = line.indexOf(':');
    if (eq <= 0) continue;
    fields.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }

  const stateValue = fields.get('STATE') ?? 'missing';
  const enabled = fields.get('ENABLED') === 'True';
  const installed = stateValue !== 'missing';
  let state: ServiceRuntimeState = 'unknown';
  if (stateValue === 'Running') state = 'running';
  else if (stateValue === 'Ready' || stateValue === 'Disabled') state = 'stopped';
  else if (stateValue === 'Unknown') state = 'unknown';
  else if (stateValue === 'missing') state = 'stopped';

  const lastResultRaw = fields.get('LAST_RESULT');
  const lastResult =
    lastResultRaw !== undefined ? Number.parseInt(lastResultRaw, 10) : undefined;
  const lastResultValue =
    lastResult !== undefined && Number.isFinite(lastResult) ? lastResult : undefined;

  if (installed && lastResultValue !== undefined && lastResultValue !== 0 && stateValue === 'Ready') {
    state = 'error';
  }

  return {
    installed,
    autostartEnabled: enabled,
    state,
    detail: stateValue,
    lastResult: lastResultValue,
  };
}

export class WindowsTaskServiceController implements ServiceController {
  readonly platform: ServicePlatform = 'win32-task';

  private readonly run: CommandRunner;
  private readonly scriptDir: string;

  constructor(options: WindowsTaskControllerOptions = {}) {
    this.run = options.runCommand ?? runCommand;
    this.scriptDir = options.scriptDir ?? '';
  }

  private scriptPath(spec: ServiceSpec, action: WindowsTaskAction): string {
    return join(this.scriptDir, `${action}-${spec.serviceName}.ps1`);
  }

  private async runScript(spec: ServiceSpec, action: WindowsTaskAction) {
    const script = this.scriptPath(spec, action);
    if (this.scriptDir) await mkdir(this.scriptDir, { recursive: true });
    await writeFile(script, buildScheduledTaskScript(action, spec), { encoding: 'utf8' });
    const result = await this.run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      script,
    ]);
    return { result, script };
  }

  async installAndStart(spec: ServiceSpec): Promise<void> {
    const { result } = await this.runScript(spec, 'install');
    if (result.code !== 0) {
      throw new Error(
        `无法注册 Windows 计划任务（exit ${result.code}）：${result.stderr.trim() || result.stdout.trim() || '未知错误'}`,
      );
    }
  }

  async start(spec: ServiceSpec): Promise<void> {
    const { result } = await this.runScript(spec, 'start');
    if (result.code !== 0) throw new Error(result.stderr.trim() || 'Windows task start failed');
  }

  async stop(spec: ServiceSpec): Promise<void> {
    const { result } = await this.runScript(spec, 'stop');
    if (result.code !== 0) {
      throw new Error(
        `无法停止 Windows 计划任务（exit ${result.code}）：${result.stderr.trim() || result.stdout.trim() || '未知错误'}`,
      );
    }
  }

  async restart(spec: ServiceSpec): Promise<void> {
    const { result } = await this.runScript(spec, 'restart');
    if (result.code !== 0) {
      throw new Error(
        `无法重启 Windows 计划任务（exit ${result.code}）：${result.stderr.trim() || result.stdout.trim() || '未知错误'}`,
      );
    }
  }

  async uninstall(spec: ServiceSpec): Promise<void> {
    const { result } = await this.runScript(spec, 'uninstall');
    if (result.code !== 0) throw new Error(result.stderr.trim() || 'Windows task uninstall failed');
  }

  async status(spec: ServiceSpec): Promise<ServiceStatus> {
    const { result } = await this.runScript(spec, 'status');
    const parsed = parseTaskStatusOutput(result.stdout);
    if (result.code !== 0 && result.code !== 2) {
      throw new Error(
        `无法查询 Windows 计划任务（exit ${result.code}）：${result.stderr.trim() || result.stdout.trim() || '未知错误'}`,
      );
    }
    return {
      name: spec.serviceName,
      platform: this.platform,
      installed: parsed.installed,
      autostartEnabled: parsed.autostartEnabled,
      state: parsed.state,
      pid: undefined,
      detail: parsed.detail,
      restarts: undefined,
    };
  }
}
