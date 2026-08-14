import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import type { StartOptions } from '../../cli.js';
import { resolveAppPaths } from '../../config/app-paths.js';
import { loadRuntimeEnv } from '../../config/env.js';
import { resolveCliJsPath, serviceNameFor } from '../../service/command.js';
import { readServiceEnv } from '../../service/env-snapshot.js';
import {
  supervisorStatusFile,
  type SupervisorStatus,
} from '../../service/portable.js';
import { writeFileAtomic } from '../../platform/atomic-write.js';

const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 30_000;

export function computeBackoffMs(restarts: number): number {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.min(restarts, 3));
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

export async function runSupervise(options: StartOptions): Promise<void> {
  const env = loadRuntimeEnv(process.env);
  const paths = resolveAppPaths(env.home);
  const profile = options.profile ?? 'default';
  const serviceName = serviceNameFor(profile);
  const statusFile = supervisorStatusFile(paths.serviceDir, serviceName);
  const logFile = paths.serviceLogFile(profile);
  const serviceEnv = await readServiceEnv(paths.serviceEnvFile);
  const childEnv = { ...process.env, ...serviceEnv };
  const cliJsPath = resolveCliJsPath();

  mkdirSync(dirname(statusFile), { recursive: true });
  mkdirSync(dirname(logFile), { recursive: true });
  const logFd = openSync(logFile, 'a');

  const writeStatus = async (
    state: SupervisorStatus['state'],
    childPid: number | undefined,
    restarts: number,
  ): Promise<void> => {
    const status: SupervisorStatus = {
      pid: process.pid,
      childPid,
      state,
      startedAt: new Date().toISOString(),
      restarts,
      profile,
    };
    await writeFileAtomic(statusFile, `${JSON.stringify(status)}\n`);
  };

  let stopping = false;
  let child: ChildProcess | undefined;
  const stop = (): void => {
    stopping = true;
    child?.kill('SIGTERM');
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);

  let restarts = 0;
  try {
    while (!stopping) {
      await writeStatus('running', undefined, restarts);
      const spawned = spawn(process.execPath, [cliJsPath, 'run', '--profile', profile], {
        env: childEnv,
        stdio: ['ignore', logFd, logFd],
      });
      child = spawned;
      await writeStatus('running', spawned.pid, restarts);
      await waitForExit(spawned);
      child = undefined;
      if (stopping) break;

      restarts += 1;
      await writeStatus('restarting', undefined, restarts);
      const backoff = computeBackoffMs(restarts);
      await sleep(backoff);
    }
  } finally {
    await writeStatus('stopped', undefined, restarts);
    closeSync(logFd);
  }
}
