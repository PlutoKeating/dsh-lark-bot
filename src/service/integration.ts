import { homedir } from 'node:os';
import { resolveAppPaths } from '../config/app-paths.js';
import { loadRuntimeEnv } from '../config/env.js';
import { ServiceManager } from './manager.js';

export interface ManagedServiceRestartResult {
  installed: boolean;
  restarted: boolean;
  detail: string;
  suppressed?: boolean;
}

/** Prefer the installed OS service so guardian/upgrade never double-launch dsh. */
export async function restartInstalledProfileService(
  profile: string,
  options: {
    env?: NodeJS.ProcessEnv;
    home?: string;
    respectIntent?: boolean;
    manager?: ServiceManager;
  } = {},
): Promise<ManagedServiceRestartResult> {
  const sourceEnv = options.env ?? process.env;
  const runtime = loadRuntimeEnv(sourceEnv);
  const manager = options.manager ?? new ServiceManager({
    profile,
    env: sourceEnv,
    home: options.home ?? homedir(),
    paths: resolveAppPaths(runtime.home),
  });
  const decision = await manager.restartManaged({
    ...(options.respectIntent === undefined ? {} : { respectIntent: options.respectIntent }),
  });
  if (decision.suppressed) {
    return {
      installed: decision.installed,
      restarted: false,
      detail: 'intentionally stopped',
      suppressed: true,
    };
  }
  if (!decision.installed || !decision.status) {
    return { installed: false, restarted: false, detail: 'not installed' };
  }
  return {
    installed: true,
    restarted: decision.status.state === 'running',
    detail: decision.status.detail,
  };
}
