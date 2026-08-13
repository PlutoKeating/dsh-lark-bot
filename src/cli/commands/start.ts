import { loadRuntimeEnv } from '../../config/env.js';
import { resolveAppPaths } from '../../config/app-paths.js';
import { log } from '../../core/logger.js';
import type { StartOptions } from '../../cli.js';

export async function runStart(options: StartOptions): Promise<void> {
  const baseEnv = loadRuntimeEnv({
    ...process.env,
    ...(options.workspace ? { DSH_LARK_WORKSPACE: options.workspace } : {}),
    ...(options.tenant ? { DSH_LARK_TENANT: options.tenant } : {}),
    ...(options.appId ? { DSH_LARK_APP_ID: options.appId } : {}),
    ...(options.appSecret ? { DSH_LARK_APP_SECRET: options.appSecret } : {}),
  });
  const paths = resolveAppPaths(baseEnv.home);
  const profile = options.profile ?? 'default';

  log.info('cli', 'start-requested', {
    profile,
    home: paths.root,
    tenant: baseEnv.tenant,
    workspace: baseEnv.workspace ?? paths.profilePath(profile, 'workspace'),
    hasAppCredentials: Boolean(baseEnv.appId && baseEnv.appSecret),
  });

  process.stdout.write('dsh-lark-bot start: connection bootstrap pending\n');
}
