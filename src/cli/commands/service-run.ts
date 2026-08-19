import { spawn, type ChildProcess } from 'node:child_process';
import { homedir } from 'node:os';
import { resolveAppPaths } from '../../config/app-paths.js';
import type { AppPaths } from '../../config/app-paths.js';
import { loadRuntimeEnv } from '../../config/env.js';
import { discoverDshBin } from '../../config/dsh-runtime.js';
import { readServiceEnv } from '../../service/env-snapshot.js';

export interface ServiceRuntimeOptions {
  profile?: string;
  envFile?: string;
}

export interface ServiceRuntimeDeps {
  spawn?: typeof spawn;
  home?: string;
  dshBin?: string;
  env?: NodeJS.ProcessEnv;
  paths?: AppPaths;
}

function waitForChild(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

/** Private OS-service entry: load the 0600 snapshot, then run canonical dsh. */
export async function runServiceRuntime(
  options: ServiceRuntimeOptions = {},
  deps: ServiceRuntimeDeps = {},
): Promise<void> {
  const sourceEnv = deps.env ?? process.env;
  const runtime = loadRuntimeEnv(sourceEnv);
  const profile = options.profile ?? 'dsh-lark';
  const paths = deps.paths ?? resolveAppPaths(runtime.home);
  const saved = await readServiceEnv(options.envFile ?? paths.serviceEnvFile(profile));
  const env = { ...sourceEnv, ...saved };
  const dshBin = deps.dshBin ?? discoverDshBin(deps.home ?? homedir(), env);
  if (!dshBin) throw new Error('未找到 dsh CLI，后台服务无法启动 profile。');

  const spawnChild = deps.spawn ?? spawn;
  const child = spawnChild(process.execPath, [dshBin, '--profile', profile], {
    env,
    stdio: 'inherit',
  });
  const forward = (signal: NodeJS.Signals): void => {
    if (!child.killed) child.kill(signal);
  };
  process.once('SIGTERM', forward);
  process.once('SIGINT', forward);
  try {
    process.exitCode = await waitForChild(child);
  } finally {
    process.off('SIGTERM', forward);
    process.off('SIGINT', forward);
  }
}
