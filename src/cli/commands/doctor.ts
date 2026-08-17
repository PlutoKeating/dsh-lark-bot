import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { buildAgentAdapter } from '../../adapters/index.js';
import { ownPackageInfo } from '../../adapters/dsh/own-package.js';
import { resolveAppPaths } from '../../config/app-paths.js';
import { loadRuntimeEnv } from '../../config/env.js';
import { ConfigStore } from '../../config/profile-store.js';
import { readGuardianUnit } from '../../guardian/install.js';
import { compareVersions, fetchNpmLatestVersionOnce } from '../../upgrade/versions.js';
import type { StartOptions } from '../../cli.js';

export interface DoctorOptions extends StartOptions {
  version?: string;
  output?: (text: string) => void;
  /** Injectable npm-latest probe (tests); defaults to a short best-effort fetch. */
  probeLatestFn?: (packageName: string) => Promise<string | undefined>;
  /** OS home used to locate the guardian service entry (tests; defaults to homedir()). */
  guardianRoot?: string;
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

  // Update reminder + install-shape drift checks (issue #15). Both are
  // best-effort: a registry hiccup must never fail doctor, and the checks can
  // be disabled with DSH_LARK_UPGRADE_CHECK=0.
  const upgradeCheckEnabled = (process.env.DSH_LARK_UPGRADE_CHECK ?? '1') !== '0';
  if (upgradeCheckEnabled && options.version) {
    try {
      const probe = options.probeLatestFn ?? fetchNpmLatestVersionOnce;
      const latest = await probe(ownPackageInfo().name);
      if (latest !== undefined) {
        lines.push(
          compareVersions(latest, options.version) > 0
            ? `upgrade: 有新版本 ${latest}（当前 ${options.version}）；执行 dsh-lark-bot upgrade 更新`
            : `upgrade: 已是最新（${latest}）`,
        );
      }
    } catch {
      // Best effort — the reminder must never fail doctor.
    }
  }
  try {
    const unit = await readGuardianUnit(
      process.platform,
      options.guardianRoot ?? homedir(),
    );
    if (unit !== undefined) {
      lines.push(
        /_npx[\\/]/.test(unit)
          ? 'guardian: ⚠️ 服务单元指向 npx 缓存路径（npm 清缓存后可能失效）；请重新执行 dsh-lark-bot guardian install'
          : 'guardian: ok (服务单元路径稳定)',
      );
    }
  } catch {
    // Best effort.
  }

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
