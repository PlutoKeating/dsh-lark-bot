import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import { homedir } from 'node:os';
import { resolveAppPaths } from '../../config/app-paths.js';
import { loadRuntimeEnv } from '../../config/env.js';
import { serviceNameFor } from '../../service/command.js';
import { discoverDshBin } from '../../config/dsh-runtime.js';
import { readServiceEnv } from '../../service/env-snapshot.js';
import {
  supervisorStatusFile,
  readLinuxProcessIdentity,
  type SupervisorStatus,
} from '../../service/portable.js';
import { writeFileAtomic } from '../../platform/atomic-write.js';

const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 30_000;
const CHILD_STOP_GRACE_MS = 4_000;

export function computeBackoffMs(restarts: number): number {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.min(restarts, 3));
}

export interface SuperviseOptions {
  profile?: string;
  envFile?: string;
}

export interface SuperviseDeps {
  spawn?: typeof spawn;
  dshBin?: string;
  childStopGraceMs?: number;
  readProcessIdentity?: typeof readLinuxProcessIdentity;
}

function waitForExit(child: ChildProcess): Promise<void> {
  return new Promise((resolvePromise) => {
    const done = (): void => resolvePromise();
    child.once('exit', done);
    child.once('error', done);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

export async function runSupervise(
  options: SuperviseOptions,
  deps: SuperviseDeps = {},
): Promise<void> {
  const profile = options.profile ?? 'dsh-lark';
  const initial = loadRuntimeEnv(process.env);
  const initialPaths = resolveAppPaths(initial.home);
  const serviceEnv = await readServiceEnv(
    options.envFile ?? initialPaths.serviceEnvFile(profile),
  );
  const childEnv = { ...process.env, ...serviceEnv };
  const env = loadRuntimeEnv(childEnv);
  const paths = resolveAppPaths(env.home);
  const serviceName = serviceNameFor(profile);
  const statusFile = supervisorStatusFile(paths.serviceDir, serviceName);
  const logFile = paths.serviceLogFile(profile);
  const dshBin = deps.dshBin ?? discoverDshBin(homedir(), childEnv);
  if (!dshBin) throw new Error('未找到 dsh CLI，portable supervisor 无法启动 profile。');

  mkdirSync(dirname(statusFile), { recursive: true });
  mkdirSync(dirname(logFile), { recursive: true });
  const logFd = openSync(logFile, 'a');

  const writeStatus = async (
    state: SupervisorStatus['state'],
    childPid: number | undefined,
    restarts: number,
  ): Promise<void> => {
    const processIdentity = await (deps.readProcessIdentity ?? readLinuxProcessIdentity)(process.pid);
    const status: SupervisorStatus = {
      pid: process.pid,
      childPid,
      state,
      startedAt: new Date().toISOString(),
      restarts,
      profile,
      ...(processIdentity ? { processIdentity } : {}),
    };
    await writeFileAtomic(statusFile, `${JSON.stringify(status)}\n`);
  };

  let stopping = false;
  let child: ChildProcess | undefined;
  let forceStopTimer: NodeJS.Timeout | undefined;
  const stop = (): void => {
    stopping = true;
    child?.kill('SIGTERM');
    if (child && forceStopTimer === undefined) {
      forceStopTimer = setTimeout(() => {
        child?.kill('SIGKILL');
      }, deps.childStopGraceMs ?? CHILD_STOP_GRACE_MS);
    }
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);

  let restarts = 0;
  try {
    while (!stopping) {
      await writeStatus('running', undefined, restarts);
      const spawned = (deps.spawn ?? spawn)(process.execPath, [dshBin, '--profile', profile], {
        env: childEnv,
        stdio: ['ignore', logFd, logFd],
      });
      child = spawned;
      // Subscribe before the first post-spawn await. A stop can otherwise
      // terminate the child while status persistence is pending, losing the
      // one-shot exit event and hanging the supervisor forever.
      const exited = waitForExit(spawned);
      await writeStatus('running', spawned.pid, restarts);
      await exited;
      if (forceStopTimer) {
        clearTimeout(forceStopTimer);
        forceStopTimer = undefined;
      }
      child = undefined;
      if (stopping) break;

      restarts += 1;
      await writeStatus('restarting', undefined, restarts);
      const backoff = computeBackoffMs(restarts);
      await sleep(backoff);
    }
  } finally {
    if (forceStopTimer) clearTimeout(forceStopTimer);
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
    await writeStatus('stopped', undefined, restarts);
    closeSync(logFd);
  }
}
