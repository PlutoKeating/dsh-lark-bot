import { stat } from 'node:fs/promises';
import { checkDshAvailability } from '../../adapters/dsh/availability.js';
import { resolveAppPaths } from '../../config/app-paths.js';
import { loadRuntimeEnv } from '../../config/env.js';
import { ConfigStore } from '../../config/profile-store.js';
import type { StartOptions } from '../../cli.js';

export interface DoctorOptions extends StartOptions {
  version?: string;
  output?: (text: string) => void;
}

export async function runDoctor(options: DoctorOptions): Promise<void> {
  const env = loadRuntimeEnv({
    ...process.env,
    ...(options.workspace ? { DSH_LARK_WORKSPACE: options.workspace } : {}),
    ...(options.tenant ? { DSH_LARK_TENANT: options.tenant } : {}),
    ...(options.appId ? { DSH_LARK_APP_ID: options.appId } : {}),
    ...(options.appSecret ? { DSH_LARK_APP_SECRET: options.appSecret } : {}),
  });
  const paths = resolveAppPaths(env.home);
  const profileName = options.profile ?? 'default';
  const store = new ConfigStore(paths.configFile);
  await store.load();
  const profile = store.getProfile(profileName);

  const lines: string[] = [
    'dsh-lark-bot doctor',
    `version: ${options.version ?? 'unknown'}`,
    `node: ${process.version}`,
    `profile: ${profileName}`,
    `home: ${paths.root}`,
    `dsh_command: ${env.dshCommand}`,
    `dsh_args: ${env.dshArgs.join(',')}`,
  ];

  let critical = false;

  if (!profile) {
    lines.push('config: missing');
    critical = true;
  } else {
    lines.push(
      [
        'config: ok',
        `tenant=${profile.tenant}`,
        `app_id=${profile.accounts.appId}`,
        `app_secret=${profile.accounts.appSecret ? 'present' : 'missing'}`,
      ].join(' '),
    );
    if (!profile.accounts.appId || !profile.accounts.appSecret) critical = true;
  }

  const workspace =
    options.workspace ??
    profile?.workspaces.default ??
    env.workspace ??
    paths.profilePath(profileName, 'workspace');
  try {
    const info = await stat(workspace);
    lines.push(`workspace: ${workspace} (${info.isDirectory() ? 'directory' : 'not-directory'})`);
  } catch {
    lines.push(`workspace: ${workspace} (missing)`);
  }

  const availability = await checkDshAvailability({ command: env.dshCommand });
  if (availability.ok) {
    lines.push(`dsh: ok${availability.version ? ` (${availability.version})` : ''}`);
  } else {
    lines.push(`dsh: unavailable (${availability.error ?? 'unknown'})`);
    critical = true;
  }

  const output = options.output ?? ((text: string) => process.stdout.write(text));
  output(`${lines.join('\n')}\n`);
  if (critical) process.exitCode = 1;
}
