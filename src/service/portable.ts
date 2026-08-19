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
  processIdentity?: (pid: number) => Promise<ProcessIdentity | undefined>;
  stopPollMs?: number;
  stopPollAttempts?: number;
}

export function defaultAutostartDir(): string {
  return join(homedir(), '.config', 'autostart');
}

export function quoteDesktopArg(arg: string): string {
  const escaped = arg.replace(/%/g, '%%').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return /[\s"\\]/.test(arg) ? `"${escaped}"` : escaped;
}

export function buildDesktopEntry(spec: ServiceSpec): string {
  const exec = [
    spec.nodePath,
    spec.cliJsPath,
    'service-supervise',
    '--profile',
    spec.profile,
    '--env-file',
    spec.envFile,
  ]
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
  processIdentity?: ProcessIdentity;
}

export interface ProcessIdentity {
  startTimeTicks: string;
  cmdline: string;
}

export async function readLinuxProcessIdentity(
  pid: number,
): Promise<ProcessIdentity | undefined> {
  try {
    const [statText, cmdlineText] = await Promise.all([
      readFile(`/proc/${pid}/stat`, 'utf8'),
      readFile(`/proc/${pid}/cmdline`, 'utf8'),
    ]);
    const close = statText.lastIndexOf(') ');
    if (close < 0) return undefined;
    const fields = statText.slice(close + 2).trim().split(/\s+/);
    const startTimeTicks = fields[19];
    if (!startTimeTicks) return undefined;
    return {
      startTimeTicks,
      cmdline: cmdlineText.replace(/\0/g, ' ').trim(),
    };
  } catch {
    return undefined;
  }
}

export function supervisorStatusFile(serviceDir: string, serviceName: string): string {
  return join(serviceDir, `supervisor-${serviceName}.json`);
}

function matchesSupervisorCommand(identity: ProcessIdentity, profile: string): boolean {
  return identity.cmdline.includes('service-supervise') &&
    identity.cmdline.includes(`--profile ${profile}`);
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
  private readonly processIdentity: (pid: number) => Promise<ProcessIdentity | undefined>;
  private readonly stopPollMs: number;
  private readonly stopPollAttempts: number;

  constructor(options: PortableControllerOptions = {}) {
    this.autostartDir = options.autostartDir ?? defaultAutostartDir();
    this.serviceDir = options.serviceDir ?? '';
    this.spawnDetached = options.spawnDetached ?? defaultSpawnDetached;
    this.processIdentity = options.processIdentity ?? readLinuxProcessIdentity;
    this.stopPollMs = options.stopPollMs ?? 250;
    this.stopPollAttempts = options.stopPollAttempts ?? 20;
  }

  private desktopPath(spec: ServiceSpec): string {
    return join(this.autostartDir, `${spec.serviceName}.desktop`);
  }

  private statusFile(spec: ServiceSpec): string {
    return supervisorStatusFile(this.serviceDir, spec.serviceName);
  }

  private async sendStopSignal(spec: ServiceSpec): Promise<void> {
    const status = await readSupervisorStatus(this.statusFile(spec));
    if (!status || !(await this.ownsSupervisor(status, spec))) {
      await rm(this.statusFile(spec), { force: true });
      return;
    }
    try {
      process.kill(status.pid, 'SIGTERM');
    } catch {
      return;
    }
    for (let attempt = 0; attempt < this.stopPollAttempts; attempt += 1) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, this.stopPollMs));
      if (!isProcessAlive(status.pid)) return;
    }
    if (!(await this.ownsSupervisor(status, spec))) return;
    try {
      // The supervisor is detached and therefore leads its own process group;
      // kill the verified group so a wedged dsh child cannot survive orphaned.
      process.kill(-status.pid, 'SIGKILL');
    } catch {
      // already gone
    }
    for (let attempt = 0; attempt < this.stopPollAttempts; attempt += 1) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, this.stopPollMs));
      if (!(await this.ownsSupervisor(status, spec))) return;
    }
    throw new Error('portable supervisor 在强制终止后仍未退出；已拒绝启动第二个实例。');
  }

  private async ownsSupervisor(status: SupervisorStatus, spec: ServiceSpec): Promise<boolean> {
    if (status.profile !== spec.profile || !status.processIdentity) return false;
    const current = await this.processIdentity(status.pid);
    return Boolean(
      current &&
      current.startTimeTicks === status.processIdentity.startTimeTicks &&
      matchesSupervisorCommand(current, spec.profile),
    );
  }

  async installAndStart(spec: ServiceSpec): Promise<void> {
    if (!this.serviceDir) throw new Error('serviceDir is required for the portable supervisor');
    await this.sendStopSignal(spec);
    await mkdir(this.autostartDir, { recursive: true });
    await writeFile(this.desktopPath(spec), buildDesktopEntry(spec), { encoding: 'utf8', mode: 0o644 });
    await mkdir(this.serviceDir, { recursive: true });
    try {
      await this.start(spec);
    } catch (error) {
      await rm(this.desktopPath(spec), { force: true });
      throw error;
    }
  }

  async start(spec: ServiceSpec): Promise<void> {
    const status = await readSupervisorStatus(this.statusFile(spec));
    if (status && await this.ownsSupervisor(status, spec)) return;
    const child = this.spawnDetached(spec.nodePath, [
      spec.cliJsPath,
      'service-supervise',
      '--profile',
      spec.profile,
      '--env-file',
      spec.envFile,
    ]);
    if (child.pid === undefined) {
      child.kill('SIGTERM');
      throw new Error('portable supervisor 未返回 PID；已终止且不会启用登录自启动。');
    }
    {
      let processIdentity: ProcessIdentity | undefined;
      for (let attempt = 0; attempt < 20 && !processIdentity; attempt += 1) {
        const candidate = await this.processIdentity(child.pid);
        processIdentity = candidate && matchesSupervisorCommand(candidate, spec.profile)
          ? candidate
          : undefined;
        if (!processIdentity) {
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
        }
      }
      if (!processIdentity) {
        child.kill('SIGTERM');
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          // The just-spawned process already exited.
        }
        throw new Error('portable supervisor 已启动，但无法验证进程身份；已终止以防止重复实例。');
      }
      const initial: SupervisorStatus = {
        pid: child.pid,
        childPid: undefined,
        state: 'running',
        startedAt: new Date().toISOString(),
        restarts: 0,
        profile: spec.profile,
        processIdentity,
      };
      await mkdir(this.serviceDir, { recursive: true });
      await writeFile(this.statusFile(spec), `${JSON.stringify(initial)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
    }
  }

  async stop(spec: ServiceSpec): Promise<void> {
    await this.sendStopSignal(spec);
  }

  async restart(spec: ServiceSpec): Promise<void> {
    await this.stop(spec);
    await this.start(spec);
  }

  async uninstall(spec: ServiceSpec): Promise<void> {
    await this.stop(spec);
    await rm(this.desktopPath(spec), { force: true });
  }

  async status(spec: ServiceSpec): Promise<ServiceStatus> {
    let desktopExists = false;
    try {
      desktopExists = (await stat(this.desktopPath(spec))).isFile();
    } catch {
      desktopExists = false;
    }
    const status = await readSupervisorStatus(this.statusFile(spec));
    const alive = status !== undefined && await this.ownsSupervisor(status, spec);
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
