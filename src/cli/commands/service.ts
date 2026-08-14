import { loadRuntimeEnv } from '../../config/env.js';
import { resolveAppPaths } from '../../config/app-paths.js';
import { ConfigStore } from '../../config/profile-store.js';
import { ServiceManager } from '../../service/manager.js';
import type { ServiceStatus } from '../../service/types.js';
import type { StartOptions } from '../../cli.js';
import { ensureBotProfile } from './run.js';

export type ServiceAction = 'start' | 'status' | 'restart' | 'stop';

export interface ServiceCommandDeps {
  manager?: ServiceManager;
  version?: string;
  output?: (text: string) => void;
}

function mergeStartEnv(options: StartOptions): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...(options.workspace ? { DSH_LARK_WORKSPACE: options.workspace } : {}),
    ...(options.tenant ? { DSH_LARK_TENANT: options.tenant } : {}),
    ...(options.appId ? { DSH_LARK_APP_ID: options.appId } : {}),
    ...(options.appSecret ? { DSH_LARK_APP_SECRET: options.appSecret } : {}),
  };
}

function createManager(options: StartOptions, version: string): ServiceManager {
  const env = loadRuntimeEnv(mergeStartEnv(options));
  const paths = resolveAppPaths(env.home);
  return new ServiceManager({
    profile: options.profile ?? 'default',
    env: mergeStartEnv(options),
    paths,
    version,
  });
}

export function printServiceStatus(status: ServiceStatus, output: (text: string) => void): void {
  const lines = [
    'dsh-lark-bot 服务状态',
    `  name:      ${status.name}`,
    `  platform:  ${status.platform}`,
    `  installed: ${status.installed ? '是' : '否'}`,
    `  autostart: ${status.autostartEnabled ? '已启用（开机自启）' : '未启用'}`,
    `  state:     ${status.state}`,
    `  detail:    ${status.detail}`,
    `  pid:       ${status.pid ?? '-'}`,
    `  restarts:  ${status.restarts ?? '-'}`,
  ];
  output(`${lines.join('\n')}\n`);
}

export async function runServiceStart(options: StartOptions, deps: ServiceCommandDeps = {}): Promise<void> {
  const version = deps.version ?? '0.0.0';
  const output = deps.output ?? ((text: string) => process.stdout.write(text));

  if (!deps.manager) {
    const env = loadRuntimeEnv(mergeStartEnv(options));
    const paths = resolveAppPaths(env.home);
    const profileName = options.profile ?? 'default';
    const store = new ConfigStore(paths.configFile);
    await store.load();
    const ready = await ensureBotProfile(store, {
      env,
      profileName,
      allowOnboarding: true,
    });
    if (!ready) {
      process.exitCode = 1;
      return;
    }
  }

  const manager = deps.manager ?? createManager(options, version);
  try {
    const status = await manager.start();
    printServiceStatus(status, output);
    if (status.state !== 'running') process.exitCode = 1;
  } catch (error) {
    output(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

export async function runServiceCommand(
  action: Exclude<ServiceAction, 'start'>,
  options: StartOptions,
  deps: ServiceCommandDeps = {},
): Promise<void> {
  const output = deps.output ?? ((text: string) => process.stdout.write(text));
  const manager = deps.manager ?? createManager(options, deps.version ?? '0.0.0');
  try {
    let status: ServiceStatus;
    if (action === 'status') {
      status = await manager.status();
    } else if (action === 'restart') {
      status = await manager.restart();
    } else {
      status = await manager.stop();
    }
    printServiceStatus(status, output);
    if (action === 'status') {
      if (status.state !== 'running') process.exitCode = 1;
    } else if (action === 'restart') {
      if (status.state !== 'running') process.exitCode = 1;
    } else if (status.state === 'running') {
      process.exitCode = 1;
    }
  } catch (error) {
    output(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
