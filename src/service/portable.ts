import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  ServiceController,
  ServicePlatform,
  ServiceSpec,
  ServiceStatus,
} from './types.js';

export interface PortableControllerOptions {
  autostartDir?: string;
  serviceDir?: string;
  spawnDetached?: (nodePath: string, args: readonly string[]) => ChildProcess;
}

export function defaultAutostartDir(): string {
  return join(homedir(), '.config', 'autostart');
}

export function quoteDesktopArg(arg: string): string {
  const escaped = arg.replace(/%/g, '%%').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return /[\s"\\]/.test(arg) ? `"${escaped}"` : escaped;
}

export function buildDesktopEntry(spec: ServiceSpec): string {
  const exec = [spec.nodePath, spec.cliJsPath, 'supervise', '--profile', spec.profile]
    .map(quoteDesktopArg)
    .join(' ');
  return [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${spec.serviceName}`,
    'Comment=Keep dsh-lark-bot running in the background',
    `Exec=${exec}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    'Hidden=false',
    '',
  ].join('\n');
}

export interface SupervisorStatus {
  pid: number;
  childPid: number | undefined;
  state: 'running' | 'restarting' | 'stopped';
  startedAt: string;
  restarts: number;
  profile: string;
}

export function supervisorStatusFile(serviceDir: string, serviceName: string): string {
  return join(serviceDir, `supervisor-${serviceName}.json`);
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export async function readSupervisorStatus(
  file: string,
): Promise<SupervisorStatus | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as SupervisorStatus;
  } catch {
    return undefined;
  }
}

function defaultSpawnDetached(nodePath: string, args: readonly string[]): ChildProcess {
  const child = spawn(nodePath, [...args], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();
  return child;
}

export class PortableServiceController implements ServiceController {
  readonly platform: ServicePlatform = 'linux-portable';

  private readonly autostartDir: string;
  private readonly serviceDir: string;
  private readonly spawnDetached: (nodePath: string, args: readonly string[]) => ChildProcess;

  constructor(options: PortableControllerOptions = {}) {
    this.autostartDir = options.autostartDir ?? defaultAutostartDir();
    this.serviceDir = options.serviceDir ?? '';
    this.spawnDetached = options.spawnDetached ?? defaultSpawnDetached;
  }

  private desktopPath(spec: ServiceSpec): string {
    return join(this.autostartDir, `${spec.serviceName}.desktop`);
  }

  private statusFile(spec: ServiceSpec): string {
    return supervisorStatusFile(this.serviceDir, spec.serviceName);
  }

  private async sendStopSignal(spec: ServiceSpec): Promise<void> {
    const status = await readSupervisorStatus(this.statusFile(spec));
    if (!status) return;
    try {
      process.kill(status.pid, 'SIGTERM');
    } catch {
      return;
    }
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
      if (!isProcessAlive(status.pid)) return;
    }
    try {
      process.kill(status.pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }

  async installAndStart(spec: ServiceSpec): Promise<void> {
    await this.sendStopSignal(spec);
    await mkdir(this.autostartDir, { recursive: true });
    await writeFile(this.desktopPath(spec), buildDesktopEntry(spec), { encoding: 'utf8', mode: 0o644 });
    if (!this.serviceDir) throw new Error('serviceDir is required for the portable supervisor');
    await mkdir(this.serviceDir, { recursive: true });
    this.spawnDetached(spec.nodePath, [spec.cliJsPath, 'supervise', '--profile', spec.profile]);
  }

  async stop(spec: ServiceSpec): Promise<void> {
    await this.sendStopSignal(spec);
    await rm(this.desktopPath(spec), { force: true });
  }

  async restart(spec: ServiceSpec): Promise<void> {
    await this.stop(spec);
    await this.installAndStart(spec);
  }

  async status(spec: ServiceSpec): Promise<ServiceStatus> {
    let desktopExists = false;
    try {
      desktopExists = (await stat(this.desktopPath(spec))).isFile();
    } catch {
      desktopExists = false;
    }
    const status = await readSupervisorStatus(this.statusFile(spec));
    const alive = status !== undefined && isProcessAlive(status.pid);
    return {
      name: spec.serviceName,
      platform: this.platform,
      installed: desktopExists,
      autostartEnabled: desktopExists,
      state: alive ? 'running' : 'stopped',
      pid: status?.childPid,
      detail: alive ? `supervisor ${status?.pid ?? '?'}` : 'stopped',
      restarts: status?.restarts,
    };
  }
}
