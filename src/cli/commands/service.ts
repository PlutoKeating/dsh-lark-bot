import { spawn } from 'node:child_process';
import { loadRuntimeEnv } from '../../config/env.js';
import { resolveAppPaths } from '../../config/app-paths.js';
import { heartbeatAgeMs, readHeartbeat } from '../../guardian/heartbeat.js';
import { ServiceManager } from '../../service/manager.js';
import type { ServiceStatus } from '../../service/types.js';

export type ServiceAction =
  | 'install'
  | 'start'
  | 'status'
  | 'logs'
  | 'restart'
  | 'stop'
  | 'uninstall';

export interface ServiceCommandOptions {
  profile?: string;
  lines?: number;
  follow?: boolean;
}

export interface ServiceCommandDeps {
  manager?: ServiceManager;
  version?: string;
  output?: (text: string) => void;
  followLog?: (path: string, lines: number) => Promise<void>;
  heartbeatAge?: () => Promise<number | undefined>;
}

function managerFor(options: ServiceCommandOptions, version: string): ServiceManager {
  const env = loadRuntimeEnv(process.env);
  return new ServiceManager({
    profile: options.profile ?? 'dsh-lark',
    env: process.env,
    paths: resolveAppPaths(env.home),
    version,
  });
}

export function formatServiceStatus(
  status: ServiceStatus,
  heartbeatAge: number | undefined,
): string {
  return [
    'dsh-lark-bot 正常引擎服务',
    `  name:      ${status.name}`,
    `  platform:  ${status.platform}`,
    `  installed: ${status.installed ? '是' : '否'}`,
    `  autostart: ${status.autostartEnabled ? '已启用' : '未启用'}`,
    `  state:     ${status.state}`,
    `  detail:    ${status.detail}`,
    `  pid:       ${status.pid ?? '-'}`,
    `  restarts:  ${status.restarts ?? '-'}`,
    `  heartbeat: ${heartbeatAge === undefined ? '暂无' : `${heartbeatAge}ms`}`,
  ].join('\n');
}

async function heartbeatAge(): Promise<number | undefined> {
  const env = loadRuntimeEnv(process.env);
  const file = resolveAppPaths(env.home).profilePath(
    env.guardianBridgeProfile,
    'guardian',
    'heartbeat.json',
  );
  const heartbeat = await readHeartbeat(file);
  return heartbeat ? heartbeatAgeMs(heartbeat) : undefined;
}

export async function runServiceCommand(
  action: ServiceAction,
  options: ServiceCommandOptions = {},
  deps: ServiceCommandDeps = {},
): Promise<void> {
  const manager = deps.manager ?? managerFor(options, deps.version ?? '0.0.0');
  const output = deps.output ?? ((text: string) => process.stdout.write(text));
  try {
    if (action === 'logs') {
      const lines = Math.max(1, options.lines ?? 100);
      const logs = await manager.logs(lines);
      output(`日志：${logs.path}\n${logs.text || '（暂无日志）'}\n`);
      if (options.follow) {
        await (deps.followLog ?? followLogFile)(logs.path, lines);
      }
      return;
    }

    const status =
      action === 'install' ? await manager.install()
        : action === 'start' ? await manager.start()
          : action === 'restart' ? await manager.restart()
            : action === 'stop' ? await manager.stop()
              : action === 'uninstall' ? await manager.uninstall()
                : await manager.status();
    output(`${formatServiceStatus(status, await (deps.heartbeatAge ?? heartbeatAge)())}\n`);
    if (
      (action === 'install' || action === 'start' || action === 'restart') &&
      status.state !== 'running'
    ) process.exitCode = 1;
    if (action === 'status' && (!status.installed || status.state === 'error')) {
      process.exitCode = 1;
    }
  } catch (error) {
    output(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

export function followLogFile(path: string, lines: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = process.platform === 'win32'
      ? spawn('powershell.exe', [
          '-NoProfile', '-Command',
          `Get-Content -Path '${path.replace(/'/g, "''")}' -Tail ${lines} -Wait`,
        ], { stdio: 'inherit' })
      : spawn('tail', ['-n', String(lines), '-F', path], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', () => resolve());
  });
}
