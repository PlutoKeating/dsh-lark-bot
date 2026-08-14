import { mkdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { writeFileAtomic } from '../platform/atomic-write.js';
import { runCommand } from './command.js';
import type {
  CommandRunner,
  ServiceController,
  ServicePlatform,
  ServiceRuntimeState,
  ServiceSpec,
  ServiceStatus,
} from './types.js';

export interface SystemdControllerOptions {
  runCommand?: CommandRunner;
  userUnitDir?: string;
}

export function defaultSystemdUnitDir(): string {
  return join(homedir(), '.config', 'systemd', 'user');
}

export function quoteSystemdArg(arg: string): string {
  if (!/[\s"\\]/.test(arg)) return arg;
  return `"${arg.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function buildSystemdUnit(spec: ServiceSpec): string {
  const exec = [spec.nodePath, spec.cliJsPath, 'run', '--profile', spec.profile]
    .map(quoteSystemdArg)
    .join(' ');
  return [
    '[Unit]',
    'Description=dsh-lark-bot bridge service',
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `EnvironmentFile=${quoteSystemdArg(spec.envFile)}`,
    `ExecStart=${exec}`,
    'Restart=always',
    'RestartSec=5',
    'KillMode=mixed',
    'TimeoutStopSec=30',
    `StandardOutput=append:${spec.logFile}`,
    `StandardError=append:${spec.logFile}`,
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
}

export async function isSystemdUserAvailable(
  runner: CommandRunner = runCommand,
): Promise<boolean> {
  const result = await runner('systemctl', ['--user', 'show-environment']);
  return result.code === 0;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function parseMainPid(value: string | undefined): number | undefined {
  const raw = value?.trim();
  if (!raw || raw === '0' || raw === '4294967295') return undefined;
  const pid = Number(raw);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

function parseNumber(value: string | undefined): number | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : undefined;
}

export class SystemdServiceController implements ServiceController {
  readonly platform: ServicePlatform = 'linux-systemd';

  private readonly run: CommandRunner;
  private readonly unitDir: string;

  constructor(options: SystemdControllerOptions = {}) {
    this.run = options.runCommand ?? runCommand;
    this.unitDir = options.userUnitDir ?? defaultSystemdUnitDir();
  }

  private unitPath(spec: ServiceSpec): string {
    return join(this.unitDir, `${spec.serviceName}.service`);
  }

  private unitName(spec: ServiceSpec): string {
    return `${spec.serviceName}.service`;
  }

  private async isActive(name: string): Promise<boolean> {
    const result = await this.run('systemctl', ['--user', 'is-active', name]);
    return result.code === 0;
  }

  async installAndStart(spec: ServiceSpec): Promise<void> {
    await mkdir(this.unitDir, { recursive: true });
    await writeFileAtomic(this.unitPath(spec), buildSystemdUnit(spec));
    await this.run('systemctl', ['--user', 'daemon-reload']);
    const name = this.unitName(spec);
    if (await this.isActive(name)) {
      await this.run('systemctl', ['--user', 'restart', name]);
    } else {
      await this.run('systemctl', ['--user', 'enable', '--now', name]);
    }
  }

  async stop(spec: ServiceSpec): Promise<void> {
    await this.run('systemctl', ['--user', 'disable', '--now', this.unitName(spec)]);
  }

  async restart(spec: ServiceSpec): Promise<void> {
    await this.run('systemctl', ['--user', 'daemon-reload']);
    await this.run('systemctl', ['--user', 'restart', this.unitName(spec)]);
  }

  async status(spec: ServiceSpec): Promise<ServiceStatus> {
    const name = this.unitName(spec);
    const unitFile = this.unitPath(spec);
    const installed = await fileExists(unitFile);

    let autostartEnabled = false;
    if (installed) {
      const enabled = await this.run('systemctl', ['--user', 'is-enabled', name]);
      autostartEnabled = enabled.code === 0 && enabled.stdout.trim() === 'enabled';
    }

    const active = await this.run('systemctl', ['--user', 'is-active', name]);
    const isActive = active.code === 0;
    let detail = active.stdout.trim() || (isActive ? 'active' : 'inactive');
    let pid: number | undefined;
    let restarts: number | undefined;

    if (isActive || installed) {
      const show = await this.run(
        'systemctl',
        ['--user', 'show', name, '-p', 'MainPID', '-p', 'ActiveState', '-p', 'NRestarts', '--value'],
      );
      // `systemctl show` prints properties in alphabetical order regardless of
      // the order they were requested in.
      const [activeState, mainPid, nRestarts] = show.stdout.trim().split('\n');
      if (activeState?.trim()) detail = activeState.trim();
      pid = parseMainPid(mainPid);
      restarts = parseNumber(nRestarts);
    }

    let state: ServiceRuntimeState;
    if (!installed) {
      state = 'stopped';
    } else if (detail === 'failed') {
      state = 'error';
    } else if (isActive || detail === 'activating' || detail === 'deactivating' || detail === 'reloading') {
      state = 'running';
    } else {
      state = 'stopped';
    }

    return {
      name: spec.serviceName,
      platform: this.platform,
      installed,
      autostartEnabled,
      state,
      pid,
      detail,
      restarts,
    };
  }
}
