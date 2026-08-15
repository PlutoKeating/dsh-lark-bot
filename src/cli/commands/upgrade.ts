/**
 * `dsh-lark-bot upgrade` — the one-command thorough-upgrade path (issue #10).
 *
 * From any previously installed shape (including pre-0.7.0 legacy layouts)
 * a single command brings the installation up to date:
 *
 *   1. the package inside the dsh profile (`dsh plugin add <name>@<target>`),
 *   2. the safety-net guardian (idempotent reinstall + service restart),
 *   3. post-upgrade verification (doctor checks).
 *
 * Running instances are handled safely: by default the command only *warns*
 * and prints the restart command; `--restart` additionally restarts the
 * guardian service and, for managed/detached profile processes, the profile
 * itself. Config, sessions, archives and credentials under `~/.dsh-lark` are
 * never touched. Every change is recorded in `~/.dsh-lark/upgrade-state.json`
 * so `--rollback` can deterministically reinstall the previous version.
 */

import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ownPackageInfo } from '../../adapters/dsh/own-package.js';
import { resolveAppPaths } from '../../config/app-paths.js';
import {
  discoverDshBin,
  resolveDshHome,
} from '../../config/dsh-runtime.js';
import { loadRuntimeEnv } from '../../config/env.js';
import { installGuardian } from '../../guardian/install.js';
import {
  detectUpgradeState,
  type UpgradeDetection,
} from '../../upgrade/detect.js';
import {
  restartGuardianService,
  restartProfileProcess,
} from '../../upgrade/service.js';
import {
  loadUpgradeState,
  saveUpgradeState,
  upgradeStatePath,
  type UpgradeRecord,
} from '../../upgrade/state.js';
import {
  compareVersions,
  fetchNpmLatestVersion,
  packageSpecFor,
} from '../../upgrade/versions.js';
import {
  repairRuntimeProfiles,
  type RuntimeProfileState,
} from '../../upgrade/runtime.js';
import { runDoctorChecks } from './doctor.js';
import { approveBuilds, runDshPlugin } from './setup.js';

export interface UpgradeOptions {
  /** dsh profile to upgrade (default `dsh-lark`). */
  profile?: string;
  /** Report-only mode: print versions / running state, change nothing. */
  check?: boolean;
  /** Skip the interactive confirmation. Non-TTY runs fail closed without it. */
  yes?: boolean;
  /** Upgrade the guardian too (default true; `--no-guardian` opts out). */
  guardian?: boolean;
  /** Restart the guardian service and (managed) dsh profile after upgrading. */
  restart?: boolean;
  /** Reinstall the previously recorded version instead of the latest. */
  rollback?: boolean;
  /** Proceed with the running package version when npm latest is unreachable. */
  force?: boolean;
  /** Explicit package spec override (advanced / tests). */
  packageSpec?: string;

  // Test seams -------------------------------------------------------------
  dshHome?: string;
  larkHome?: string;
  /** Root for guardian service-entry / state paths (tests; defaults to homedir). */
  guardianRoot?: string;
  /** dsh CLI bin override for `dsh plugin add` (tests / unusual layouts). */
  dshBin?: string;
  output?: (text: string) => void;
  confirmFn?: (prompt: string) => Promise<boolean>;
  fetchLatestFn?: typeof fetchNpmLatestVersion;
  installGuardianFn?: typeof installGuardian;
  restartGuardianFn?: typeof restartGuardianService;
  restartProfileFn?: typeof restartProfileProcess;
  pluginSpawnFn?: typeof runDshPlugin;
  runDoctorFn?: typeof runDoctorChecks;
  repairRuntimeFn?: typeof repairRuntimeProfiles;
  listProcessesFn?: typeof import('../../guardian/process.js').listProcesses;
  stateFile?: string;
}

interface Target {
  version: string;
  spec: string;
}

function write(
  out: (text: string) => void,
  text: string,
): void {
  out(text);
}

async function defaultConfirm(prompt: string): Promise<boolean> {
  // Fail closed: non-interactive runs must pass --yes to change anything.
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${prompt} [y/N] `, (answer) => {
      rl.close();
      resolve(/^y(?:es)?$/i.test(answer.trim()));
    });
  });
}

async function resolveTarget(
  options: UpgradeOptions,
  detection: UpgradeDetection,
  out: (text: string) => void,
): Promise<Target | undefined> {
  const own = detection.own;
  if (options.rollback) {
    const state = await loadUpgradeState(
      options.stateFile ??
        upgradeStatePath(options.larkHome ?? resolveAppPaths().root),
    );
    if (!state?.lastUpgrade) {
      write(out, '没有可回滚的已记录升级（upgrade-state.json 缺失或为空）。\n');
      return undefined;
    }
    const from = state.lastUpgrade.fromVersion;
    if (from === 'none') {
      write(out, '无法回滚：未记录到上一个版本（首次安装无回滚目标）。\n');
      return undefined;
    }
    if (
      detection.installed !== undefined &&
      compareVersions(detection.installed.version, from) <= 0
    ) {
      write(out, `已处于（或早于）回滚目标版本 ${from}，无需回滚。\n`);
      return undefined;
    }
    return { version: from, spec: packageSpecFor(own.name, from) };
  }

  if (options.packageSpec) {
    const at = options.packageSpec.lastIndexOf('@');
    const version =
      at > 0 ? options.packageSpec.slice(at + 1) : undefined;
    if (!version) {
      write(out, `--package 需要 name@version 形式（收到：${options.packageSpec}）。\n`);
      return undefined;
    }
    return { version, spec: options.packageSpec };
  }

  const latest = await (options.fetchLatestFn ?? fetchNpmLatestVersion)(
    own.name,
  );
  if (!latest) {
    if (options.force && own.version) {
      write(
        out,
        '⚠️ 无法获取 npm 最新版本（可能离线）；--force 已指定，将按当前运行版本重新安装。\n',
      );
      return { version: own.version, spec: packageSpecFor(own.name, own.version) };
    }
    write(
      out,
      '无法获取 npm 最新版本（可能离线）。请检查网络后重试，或使用 --force 以当前版本继续。\n',
    );
    return undefined;
  }
  return { version: latest, spec: packageSpecFor(own.name, latest) };
}

function reportVersions(
  out: (text: string) => void,
  detection: UpgradeDetection,
  latest: string | undefined,
): void {
  write(out, 'dsh-lark-bot upgrade\n');
  write(
    out,
    `运行中 CLI 版本: ${detection.own.name} ${detection.own.version ?? 'unknown'}\n`,
  );
  write(
    out,
    `已安装（profile ${detection.profile}）: ${detection.installed?.version ?? '未安装'}\n`,
  );
  write(out, `npm 最新: ${latest ?? '未知（离线？）'}\n`);
  write(
    out,
    `dsh 进程: ${detection.profileProcess ? `运行中 (pid ${detection.profileProcess.pid})` : '未运行'}\n`,
  );
  write(
    out,
    `guardian: ${detection.guardian.installed ? '已安装' : '未安装'}${
      detection.guardian.running ? ' / 运行中' : ' / 未运行'
    }\n`,
  );
  write(
    out,
    `bridge 心跳: ${detection.heartbeatFresh ? '新鲜' : '过期/无'}\n`,
  );
}

export async function runUpgrade(options: UpgradeOptions = {}): Promise<void> {
  const out = options.output ?? ((text: string) => process.stdout.write(text));
  const own = ownPackageInfo();
  const env = loadRuntimeEnv(process.env);
  const home = options.larkHome ?? resolveAppPaths().root;
  const dshHome = options.dshHome ?? resolveDshHome(homedir(), process.env);
  const profile = options.profile ?? 'dsh-lark';
  const guardian = options.guardian !== false;
  const stateFile =
    options.stateFile ?? upgradeStatePath(home);
  const confirm = options.confirmFn ?? defaultConfirm;

  const detection = await detectUpgradeState({
    profile,
    dshHome,
    larkHome: home,
    ...(options.guardianRoot ? { guardianRoot: options.guardianRoot } : {}),
    ...(options.listProcessesFn ? { listProcessesFn: options.listProcessesFn } : {}),
  });

  // --check: report-only.
  if (options.check) {
    const latest = await (options.fetchLatestFn ?? fetchNpmLatestVersion)(
      own.name,
    );
    reportVersions(out, detection, latest);
    const doctor = await (options.runDoctorFn ?? runDoctorChecks)({
      profile,
      ...(own.version ? { version: own.version } : {}),
    });
    for (const line of doctor.lines) write(out, `${line}\n`);
    if (doctor.critical) {
      write(out, '⚠️ doctor 检查存在关键问题，升级前请先排查。\n');
    }
    return;
  }

  const target = await resolveTarget(options, detection, out);
  if (!target) return;

  const installedVersion = detection.installed?.version;
  const packageChanged =
    installedVersion === undefined || compareVersions(target.version, installedVersion) !== 0;
  const guardianMissing = guardian && !detection.guardian.installed;

  // Nothing to do?
  if (!packageChanged && !guardianMissing && !options.force && !options.packageSpec) {
    reportVersions(out, detection, target.version);
    write(
      out,
      `✅ ${own.name} 已是最新（${installedVersion}），guardian 状态正常，无需升级。\n`,
    );
    return;
  }

  reportVersions(out, detection, target.version);
  const changeLines: string[] = [];
  if (packageChanged) {
    changeLines.push(
      `  • 包本体: ${detection.installed?.version ?? '未安装'} → ${target.version}`,
    );
  }
  if (guardian) {
    changeLines.push(
      `  • guardian: ${detection.guardian.installed ? '重新安装并重启服务' : '安装服务'}`,
    );
  }
  if (options.restart) {
    changeLines.push('  • 重启: 将尝试重启 guardian 服务与运行中的 dsh profile 进程');
  }
  write(out, `即将执行：\n${changeLines.join('\n')}\n`);

  if (!options.yes) {
    const ok = await confirm('确认执行上述升级？');
    if (!ok) {
      write(out, '已取消，未做任何更改。\n');
      return;
    }
  }

  const fromVersion = installedVersion ?? 'none';
  const startedAt = new Date().toISOString();

  // 1. Package upgrade inside the profile.
  if (packageChanged) {
    write(out, `正在把 ${target.spec} 安装到 dsh profile \`${profile}\`...\n`);
    const profileDir = join(dshHome, 'profiles', profile);
    await mkdir(profileDir, { recursive: true });
    await approveBuilds(profileDir);
    const bin = options.dshBin ?? discoverDshBin(homedir(), process.env);
    if (!bin) {
      write(out, '未找到本机 dsh 安装，无法执行插件升级。请先安装 DeepSeek Harness。\n');
      return;
    }
    await (options.pluginSpawnFn ?? runDshPlugin)(bin, profile, target.spec);
    write(out, `✅ 包本体已更新到 ${target.version}。\n`);

    // 1b. Runtime profiles (dsh-lark-sdk / dsh-lark-acp): after a package
    //     change their own-package link points at the old root; relink to the
    //     running package so the next boot does not need to re-provision.
    const repair = options.repairRuntimeFn ?? repairRuntimeProfiles;
    const runtimeStates: RuntimeProfileState[] = await repair({
      dshHome,
      env: process.env,
    });
    for (const state of runtimeStates) {
      if (!state.existed) continue;
      if (state.ok) {
        write(
          out,
          `runtime profile ${state.profile}: ${state.repaired ? 'own-package 链接已修复' : '就绪'}。\n`,
        );
      } else {
        write(
          out,
          `runtime profile ${state.profile}: 需要重新预置（下次启动会自动自愈；也可运行 dsh-lark-bot doctor 检查）。\n`,
        );
      }
    }
  } else {
    write(out, `包本体无需变更（已安装 ${installedVersion}）。\n`);
  }

  // 2. Guardian: idempotent reinstall (rewrites the service entry to the new
  //    cli.js) then restart so the resident process runs the new code.
  if (guardian) {
    const install = options.installGuardianFn ?? installGuardian;
    const result = await install({ env, dshProfile: profile });
    for (const message of result.messages) write(out, `${message}\n`);
    if (result.ok) {
      if (options.restart) {
        const restart = options.restartGuardianFn ?? restartGuardianService;
        const restarted = await restart(process.platform, {});
        write(out, `${restarted.message}\n`);
        if (!restarted.ok) write(out, '提示：可稍后手动执行 dsh-lark-bot guardian status 检查。\n');
      } else {
        write(
          out,
          '提示：guardian 服务已更新，但仍在运行旧代码；如需立即生效请执行 dsh-lark-bot guardian install 后重启服务，或加 --restart 重跑。\n',
        );
      }
    } else {
      write(out, '注意：guardian 服务未完全启用，请按上方提示手动处理；可稍后重跑 dsh-lark-bot guardian install。\n');
    }
  } else {
    write(out, '已跳过 guardian（--no-guardian）。\n');
  }

  // 3. Optional profile-process restart (explicit opt-in).
  if (options.restart && detection.profileProcess) {
    const restartProfile = options.restartProfileFn ?? restartProfileProcess;
    const restarted = await restartProfile(profile, {});
    write(out, `${restarted.message}\n`);
  } else if (detection.profileProcess && !options.restart) {
    write(
      out,
      `⚠️ dsh profile 进程正在运行（pid ${detection.profileProcess.pid}）。为加载新版本，请手动重启：\n`,
    );
    write(out, `    dsh --profile ${profile}\n`);
    write(out, '（升级不会中断运行中的会话；配置/会话/凭据均不受影响。）\n');
  }

  // 4. Record the change for rollback.
  if (packageChanged) {
    const record: UpgradeRecord = {
      at: startedAt,
      fromVersion,
      toVersion: target.version,
      profile,
      packageSpec: target.spec,
      guardianInstalled: guardian,
    };
    await saveUpgradeState(stateFile, { schemaVersion: 1, lastUpgrade: record });
    write(
      out,
      `已记录升级状态（回滚命令：dsh-lark-bot upgrade --rollback${profile === 'dsh-lark' ? '' : ` --profile ${profile}`}）。\n`,
    );
  }

  // 5. Post-upgrade verification.
  write(out, '\n--- 升级后验证（doctor）---\n');
  const doctor = await (options.runDoctorFn ?? runDoctorChecks)({
    profile,
    ...(own.version ? { version: own.version } : {}),
  });
  for (const line of doctor.lines) write(out, `${line}\n`);
  if (doctor.critical) {
    write(out, '⚠️ doctor 检查发现关键问题，请运行 dsh-lark-bot doctor 排查。\n');
  } else {
    write(out, '✅ 升级后验证通过。\n');
  }
}
