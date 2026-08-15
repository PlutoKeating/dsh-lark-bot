import { stat } from 'node:fs/promises';
import { buildAgentAdapter } from '../../adapters/index.js';
import { resolveAppPaths } from '../../config/app-paths.js';
import { loadRuntimeEnv } from '../../config/env.js';
import { ConfigStore } from '../../config/profile-store.js';
import type { StartOptions } from '../../cli.js';

export interface DoctorOptions extends StartOptions {
  version?: string;
  output?: (text: string) => void;
}

export interface DoctorResult {
  lines: string[];
  critical: boolean;
}

/**
 * Core diagnostics, shared by the `doctor` command and the post-upgrade
 * verification inside `dsh-lark-bot upgrade`. Returns the report lines and
 * whether any critical check failed; never writes to stdout / exit code
 * itself.
 */
export async function runDoctorChecks(
  options: DoctorOptions,
): Promise<DoctorResult> {
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
    `adapter: ${env.adapterMode}`,
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
        `allowed_users=${profile.access.allowedUsers.length}`,
        `allowed_chats=${profile.access.allowedChats.length}`,
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

  try {
    const adapter = await buildAgentAdapter(env, {
      stopGraceMs: profile?.preferences.stopGraceMs,
      model: profile?.preferences.model,
    });
    const availability = await adapter.checkAvailability();
    if (availability.ok) {
      lines.push(`dsh: ok${availability.version ? ` (${availability.version})` : ''}`);
    } else {
      lines.push(`dsh: unavailable (${availability.error ?? 'unknown'})`);
      critical = true;
    }
    await adapter.dispose?.();
  } catch (error) {
    lines.push(`dsh: unavailable (${error instanceof Error ? error.message : String(error)})`);
    critical = true;
  }

  return { lines, critical };
}

export async function runDoctor(options: DoctorOptions): Promise<void> {
  const { lines, critical } = await runDoctorChecks(options);
  const output = options.output ?? ((text: string) => process.stdout.write(text));
  output(`${lines.join('\n')}\n`);
  if (critical) process.exitCode = 1;
}
