import { join } from 'node:path';
import { loadRuntimeEnv, type RuntimeEnv } from '../../config/env.js';
import {
  guardianLayoutFor,
  buildGuardianService,
} from '../../guardian/service.js';
import {
  heartbeatAgeMs,
  isHeartbeatFresh,
  readHeartbeat,
} from '../../guardian/heartbeat.js';
import {
  installGuardian,
  uninstallGuardian,
  type InstallResult,
} from '../../guardian/install.js';
import { findProfileProcess } from '../../guardian/process.js';
import {
  loadGuardianState,
  newGuardianState,
} from '../../guardian/state.js';
import { resolveAppPaths } from '../../config/app-paths.js';

export interface GuardianCommandOptions {
  dshProfile?: string;
  bridgeProfile?: string;
}

function envWithOverrides(options: GuardianCommandOptions): RuntimeEnv {
  const env = loadRuntimeEnv(process.env);
  if (options.dshProfile) env.guardianProfile = options.dshProfile;
  if (options.bridgeProfile) env.guardianBridgeProfile = options.bridgeProfile;
  return env;
}

function printLines(lines: readonly string[]): void {
  process.stdout.write(`${lines.join('\n')}\n`);
}

/** Run the guardian in the foreground (the system service entry point). */
export async function runGuardian(
  options: GuardianCommandOptions = {},
): Promise<void> {
  const env = envWithOverrides(options);
  if (env.guardianDisabled) {
    printLines(['安全网守护已禁用（DSH_LARK_GUARDIAN_DISABLED=1），进程退出。']);
    return;
  }
  const service = await buildGuardianService(env);
  await service.start();
  printLines([
    `安全网守护运行中（pid=${process.pid}，dsh profile=${service.snapshot().dshProfile}）。`,
    'dsh 正常运行时保持静默；dsh 下线后自动接管飞书通道，等待 /safemode 控制信号。',
  ]);
  await waitForShutdown();
  await service.stop();
}

/** Install the guardian as a system-level resident service. */
export async function installGuardianCommand(
  options: GuardianCommandOptions = {},
): Promise<void> {
  const env = envWithOverrides(options);
  const result = await installGuardian({ env, ...(options.dshProfile ? { dshProfile: options.dshProfile } : {}) });
  printResult(result);
  if (!result.ok) process.exitCode = 1;
}

export async function uninstallGuardianCommand(
  options: GuardianCommandOptions = {},
): Promise<void> {
  const env = envWithOverrides(options);
  const result = await uninstallGuardian({ env });
  printResult(result);
}

/** Print a human-readable guardian status without starting the service. */
export async function statusGuardianCommand(
  options: GuardianCommandOptions = {},
): Promise<void> {
  const env = envWithOverrides(options);
  const paths = resolveAppPaths(env.home);
  const fallback = newGuardianState({
    dshProfile: env.guardianProfile,
    bridgeProfile: env.guardianBridgeProfile,
  });
  const state = await loadGuardianState(join(paths.root, 'guardian.json'), fallback);
  const layout = guardianLayoutFor(env, state.bridgeProfile);
  const heartbeat = await readHeartbeat(layout.heartbeatFile);
  const processFound = await findProfileProcess(state.dshProfile);
  const up =
    isHeartbeatFresh(heartbeat, env.guardianStaleMs) || processFound !== undefined;
  printLines([
    '安全网守护状态',
    '---------------',
    `模式：${state.mode}`,
    `dsh profile：${state.dshProfile}`,
    `安全 profile：${state.safeProfile}`,
    `桥接 profile：${state.bridgeProfile}`,
    `dsh 是否在线：${up ? '是' : '否'}${processFound ? `（pid ${processFound.pid}）` : ''}`,
    `心跳龄：${heartbeat ? `${heartbeatAgeMs(heartbeat)}ms` : '无'}`,
    `已观察过 dsh 运行：${state.profileSeenUp ? '是' : '否'}`,
    `守护进程 pid：${process.pid}`,
    `状态文件：${layout.stateFile}`,
    `心跳文件：${layout.heartbeatFile}`,
  ]);
}

function printResult(result: InstallResult): void {
  for (const message of result.messages) {
    process.stdout.write(`${message}\n`);
  }
}

function waitForShutdown(): Promise<void> {
  return new Promise((resolve) => {
    // The guardian service's poll timer is unref'd (so embedding and tests do
    // not pin the process), therefore the foreground service entry must hold
    // the event loop itself until SIGINT / SIGTERM arrives; otherwise Node
    // drains the loop and exits with an unsettled top-level await.
    const keepAlive = setInterval(() => {}, 2 ** 31 - 1);
    const shutdown = (): void => {
      clearInterval(keepAlive);
      process.off('SIGINT', shutdown);
      process.off('SIGTERM', shutdown);
      resolve();
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}
