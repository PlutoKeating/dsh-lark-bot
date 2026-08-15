/**
 * Service restart helpers for `dsh-lark-bot upgrade`.
 *
 * After the package files are replaced, the safety-net guardian must be
 * restarted so the resident process (and the service entry that launches it)
 * run the new code; systemd / launchd keep the old process alive until told
 * otherwise, and a Windows startup entry only re-launches at next login.
 *
 * Restarting the dsh profile process itself is an explicit opt-in
 * (`--restart`): interactive terminal sessions cannot be meaningfully
 * "restarted" by another process, so this only targets detached / managed
 * profile processes and always explains the manual alternative.
 */

import { homedir } from 'node:os';
import { GUARDIAN_LABEL } from '../guardian/install.js';
import {
  findProfileProcess,
  spawnDetached,
  type DetachedSpawn,
} from '../guardian/process.js';
import { discoverDshBin } from '../config/dsh-runtime.js';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type RunFn = (
  command: string,
  args: readonly string[],
) => Promise<RunResult>;

async function defaultRun(
  command: string,
  args: readonly string[],
): Promise<RunResult> {
  const { captureOutput } = await import('../guardian/process.js');
  return captureOutput(command, args, 30_000);
}

export interface RestartGuardianOptions {
  root?: string;
  userOverride?: string;
  run?: RunFn;
}

export interface RestartGuardianResult {
  ok: boolean;
  message: string;
}

export async function restartGuardianService(
  platform: NodeJS.Platform,
  options: RestartGuardianOptions = {},
): Promise<RestartGuardianResult> {
  const run = options.run ?? defaultRun;
  if (platform === 'linux') {
    const result = await run('systemctl', [
      '--user',
      'restart',
      `${GUARDIAN_LABEL}.service`,
    ]);
    return result.code === 0
      ? { ok: true, message: 'guardian 服务已重启（systemctl --user restart）。' }
      : {
          ok: false,
          message: `guardian 服务重启失败（code ${result.code}）。请手动执行：systemctl --user restart ${GUARDIAN_LABEL}.service`,
        };
  }
  if (platform === 'darwin') {
    const uid =
      options.userOverride ?? String(process.getuid?.() ?? 501);
    const label = `io.dsh-lark.${GUARDIAN_LABEL}`;
    const result = await run('launchctl', [
      'kickstart',
      '-k',
      `gui/${uid}/${label}`,
    ]);
    return result.code === 0
      ? { ok: true, message: 'guardian 服务已重启（launchctl kickstart -k）。' }
      : {
          ok: false,
          message: `guardian 服务重启失败（code ${result.code}）。请手动执行：launchctl kickstart -k gui/${uid}/${label}`,
        };
  }
  if (platform === 'win32') {
    return {
      ok: true,
      message:
        'Windows 启动项将在下次登录时自动加载新版本；如需立即生效，请手动运行启动脚本或重启系统。',
    };
  }
  return {
    ok: true,
    message: '当前平台不支持自动重启守护服务，请按需手动重启。',
  };
}

export interface RestartProfileOptions {
  dshBin?: string;
  home?: string;
  env?: NodeJS.ProcessEnv;
  spawn?: typeof spawnDetached;
  findProcess?: typeof findProfileProcess;
  /** Extra args appended to the relaunch (e.g. environment passthrough). */
  extraArgs?: readonly string[];
}

export interface RestartProfileResult {
  ok: boolean;
  message: string;
}

export async function restartProfileProcess(
  profile: string,
  options: RestartProfileOptions = {},
): Promise<RestartProfileResult> {
  const findProcess = options.findProcess ?? findProfileProcess;
  const proc = await findProcess(profile);
  if (!proc) {
    return {
      ok: false,
      message: `未发现运行中的 dsh profile 进程（${profile}），无需重启。`,
    };
  }
  const bin =
    options.dshBin ??
    discoverDshBin(options.home ?? homedir(), options.env ?? process.env);
  if (!bin) {
    return {
      ok: false,
      message: `未找到 dsh 启动入口，无法自动重启。请手动执行：dsh --profile ${profile}`,
    };
  }
  try {
    process.kill(proc.pid, 'SIGTERM');
  } catch (error) {
    return {
      ok: false,
      message: `终止旧进程失败（pid ${proc.pid}）：${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  // Give the old process a moment to release its resources (Feishu channel,
  // runtime subprocesses) before relaunching.
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  const spawn = options.spawn ?? spawnDetached;
  const spawned: DetachedSpawn = spawn('node', [
    bin,
    '--profile',
    profile,
    ...(options.extraArgs ?? []),
  ]);
  return spawned.pid !== undefined
    ? {
        ok: true,
        message: `旧进程已终止（pid ${proc.pid}），已重新拉起 dsh --profile ${profile}（pid ${spawned.pid}，后台运行）。`,
      }
    : {
        ok: false,
        message: `旧进程已终止（pid ${proc.pid}），但自动重启失败。请手动执行：dsh --profile ${profile}`,
      };
}
