import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createLarkChannel } from '@larksuite/channel';
import { buildAgentAdapter } from '../../adapters/index.js';
import { ScopeDirectory } from '../../bridge/scope-directory.js';
import { ownPackageInfo } from '../../adapters/dsh/own-package.js';
import { resolveAppPaths } from '../../config/app-paths.js';
import { resolveDshHome } from '../../config/dsh-runtime.js';
import { loadRuntimeEnv } from '../../config/env.js';
import { ConfigStore } from '../../config/profile-store.js';
import { readGuardianUnit } from '../../guardian/install.js';
import { readInstalledPackage } from '../../upgrade/detect.js';
import { loadUpgradeState, upgradeStatePath } from '../../upgrade/state.js';
import { compareVersions, fetchNpmLatestVersionOnce } from '../../upgrade/versions.js';
import type { StartOptions } from '../../cli.js';
import { ServiceManager } from '../../service/manager.js';

export interface DoctorOptions extends StartOptions {
  version?: string;
  output?: (text: string) => void;
  /** Injectable npm-latest probe (tests); defaults to a short best-effort fetch. */
  probeLatestFn?: (packageName: string) => Promise<string | undefined>;
  /** OS home used to locate the guardian service entry (tests; defaults to homedir()). */
  guardianRoot?: string;
  /** Injectable Feishu group-history probe (tests). */
  probeGroupHistoryFn?: (input: {
    appId: string;
    appSecret: string;
    tenant: 'feishu' | 'lark';
    chatId: string;
  }) => Promise<{ ok: boolean; error?: string }>;
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
  try {
    const service = new ServiceManager({
      profile: env.guardianProfile,
      env: process.env,
      paths,
      home: options.guardianRoot ?? homedir(),
      ...(options.version ? { version: options.version } : {}),
    });
    if (await service.readMetadata()) {
      const status = await service.status();
      lines.push(
        `service: ${status.state} (${status.platform}; autostart=${status.autostartEnabled ? 'on' : 'off'}${status.pid ? `; pid=${status.pid}` : ''})`,
      );
      if (!status.installed) {
        lines.push('service: ⚠️ 元数据存在但系统服务入口缺失；请重跑 dsh-lark-bot service install');
      }
    }
  } catch (error) {
    lines.push(`service: ⚠️ 状态检查失败（${error instanceof Error ? error.message : String(error)}）`);
  }
  try {
    const state = await loadUpgradeState(upgradeStatePath(env.home));
    if (state?.lastUpgrade.pendingRestart === true) {
      lines.push(
        'upgrade: 上次升级未自动重启（如尚未重启，请重启 dsh profile 以加载新版本）。',
      );
    }
  } catch {
    // Best effort.
  }
  try {
    // Version-pin drift check for runtime profiles (issue #15): the sdk/acp
    // profiles link the bridge package; a stale link means the next boot may
    // re-provision or run an old copy. `dsh-lark-bot upgrade` repairs these.
    const dshHome = resolveDshHome(homedir(), process.env);
    const name = ownPackageInfo().name;
    const installed = await readInstalledPackage(
      dshHome,
      env.guardianProfile ?? 'dsh-lark',
      name,
    );
    for (const runtimeProfile of ['dsh-lark-sdk', 'dsh-lark-acp']) {
      const linked = await runtimeProfileLinkVersion(dshHome, runtimeProfile, name);
      if (linked === undefined) continue;
      if (installed !== undefined && linked !== installed.version) {
        lines.push(
          `runtime ${runtimeProfile}: ⚠️ 链接版本 ${linked} 与已装 ${installed.version} 不一致；执行 dsh-lark-bot upgrade 修复`,
        );
      } else {
        lines.push(`runtime ${runtimeProfile}: ok (${linked})`);
      }
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

  if (env.groupNoAt && profile) {
    if (profile.access.allowedUsers.length === 0) {
      lines.push(
        'group_no_at: blocked (请先配置 allowed_users，并在目标群中 @ 机器人一次)',
      );
    } else {
      const scopes = new ScopeDirectory(paths.profilePath(profileName, 'scopes.json'));
      await scopes.load();
      const target = scopes
        .knownChats()
        .find((chat) => chat.chatMode === 'group' || chat.chatMode === 'topic');
      if (!target) {
        lines.push('group_no_at: pending (请先在目标群中 @ 机器人一次以登记群聊)');
      } else {
        try {
          const probe = options.probeGroupHistoryFn ?? probeGroupHistoryAccess;
          const result = await probe({
            appId: profile.accounts.appId,
            appSecret: profile.accounts.appSecret,
            tenant: profile.tenant,
            chatId: target.chatId,
          });
          lines.push(
            result.ok
              ? 'group_no_at: ok (群消息历史权限可用)'
              : `group_no_at: unavailable (${result.error ?? '请检查 im:message.group_msg 权限'})`,
          );
        } catch (error) {
          lines.push(
            `group_no_at: unavailable (${error instanceof Error ? error.message : String(error)})`,
          );
        }
      }
    }
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

async function probeGroupHistoryAccess(input: {
  appId: string;
  appSecret: string;
  tenant: 'feishu' | 'lark';
  chatId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const channel = createLarkChannel({
    appId: input.appId,
    appSecret: input.appSecret,
    domain:
      input.tenant === 'lark'
        ? 'https://open.larksuite.com'
        : 'https://open.feishu.cn',
    source: 'dsh-lark-bot-doctor',
  });
  const response = await channel.rawClient.im.message.list({
    params: {
      container_id_type: 'chat',
      container_id: input.chatId,
      sort_type: 'ByCreateTimeDesc',
      page_size: 1,
    },
  });
  if (response.code !== undefined && response.code !== 0) {
    return {
      ok: false,
      error: `Feishu API ${response.code}: ${response.msg ?? 'unknown error'}`,
    };
  }
  return { ok: true };
}

async function runtimeProfileLinkVersion(
  dshHome: string,
  runtimeProfile: string,
  packageName: string,
): Promise<string | undefined> {
  try {
    const raw = await readFile(
      join(dshHome, 'profiles', runtimeProfile, 'node_modules', packageName, 'package.json'),
      'utf8',
    );
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

export async function runDoctor(options: DoctorOptions): Promise<void> {
  const { lines, critical } = await runDoctorChecks(options);
  const output = options.output ?? ((text: string) => process.stdout.write(text));
  output(`${lines.join('\n')}\n`);
  if (critical) process.exitCode = 1;
}
