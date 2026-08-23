import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { writeFileAtomic } from '../platform/atomic-write.js';
import { ownPackageInfo } from '../adapters/dsh/own-package.js';
import { captureOutput } from './process.js';
import { defaultRegistryUrl } from '../upgrade/versions.js';

export interface GuardianUpdateRoute {
  chatId: string;
  threadId?: string;
  requesterId: string;
}

export interface GuardianUpdateWorkerRequest {
  id: string;
  stateFile: string;
  packageName: string;
  targetVersion: string;
  dshProfile: string;
}

export interface GuardianUpdateState {
  schemaVersion: 1;
  id: string;
  status: 'running' | 'succeeded' | 'failed';
  packageName: string;
  targetVersion: string;
  dshProfile: string;
  route: GuardianUpdateRoute;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  delivered?: boolean;
}

export interface GuardianUpdateHandoffOptions {
  file: string;
  packageName: string;
  dshProfile: string;
  launch?: (request: GuardianUpdateWorkerRequest) => Promise<void>;
  now?: () => Date;
  id?: () => string;
  runningTimeoutMs?: number;
}

export interface GuardianUpdateWorkerOptions {
  run?: typeof captureOutput;
  delayMs?: number;
  now?: () => Date;
}

export type StartGuardianUpdateResult =
  | { accepted: true; id: string }
  | { accepted: false; reason: 'busy'; id: string };

async function loadState(file: string): Promise<GuardianUpdateState | undefined> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as GuardianUpdateState;
    return parsed.schemaVersion === 1 && typeof parsed.id === 'string' ? parsed : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function saveState(file: string, state: GuardianUpdateState): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFileAtomic(file, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

function validPackageName(value: string): boolean {
  return /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(value);
}

function validVersion(value: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

async function defaultLaunch(request: GuardianUpdateWorkerRequest): Promise<void> {
  // This module is bundled into several entry files (`plugin.js`, `cli.js`),
  // so import.meta.url is not a stable way to locate the CLI after build.
  const cliPath = join(ownPackageInfo().root, 'dist', 'cli.js');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [
      cliPath,
      'guardian-update-worker',
      '--state-file', request.stateFile,
      '--request-id', request.id,
    ], {
      detached: process.platform !== 'win32',
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env },
    });
    child.once('spawn', () => {
      if (process.platform !== 'win32') child.unref();
      resolve();
    });
    child.once('error', reject);
  });
}

export async function runGuardianUpdateWorker(
  request: { stateFile: string; id: string },
  options: GuardianUpdateWorkerOptions = {},
): Promise<void> {
  const state = await loadState(request.stateFile);
  if (!state || state.id !== request.id || state.status !== 'running') {
    throw new Error('guardian update request is missing, stale, or already complete');
  }
  if (!validPackageName(state.packageName) || !validVersion(state.targetVersion)) {
    throw new Error('guardian update request contains an invalid package or version');
  }
  const delayMs = options.delayMs ?? 1_500;
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  const spec = `${state.packageName}@${state.targetVersion}`;
  const run = options.run ?? captureOutput;
  const result = await run(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    [
      '--yes',
      '--registry', defaultRegistryUrl(),
      spec,
      'upgrade',
      '--profile', state.dshProfile,
      '--yes',
      '--restart',
      '--package', spec,
    ],
    30 * 60_000,
  );
  const finished: GuardianUpdateState = {
    ...state,
    status: result.code === 0 ? 'succeeded' : 'failed',
    finishedAt: (options.now ?? (() => new Date()))().toISOString(),
    delivered: false,
    ...(result.code === 0
      ? {}
      : { error: (result.stderr || result.stdout || `upgrade exited with code ${result.code}`).slice(0, 2_000) }),
  };
  await saveState(request.stateFile, finished);
}

/**
 * Durable handoff from the live bridge to an update worker that can outlive
 * the bridge process while the guardian keeps the Feishu safety net present.
 */
export class GuardianUpdateHandoff {
  private readonly launch: (request: GuardianUpdateWorkerRequest) => Promise<void>;
  private readonly now: () => Date;
  private readonly id: () => string;
  private startQueue: Promise<void> = Promise.resolve();

  constructor(private readonly options: GuardianUpdateHandoffOptions) {
    this.launch = options.launch ?? defaultLaunch;
    this.now = options.now ?? (() => new Date());
    this.id = options.id ?? randomUUID;
  }

  async start(
    targetVersion: string,
    route: GuardianUpdateRoute,
  ): Promise<StartGuardianUpdateResult> {
    let release!: () => void;
    const previous = this.startQueue;
    this.startQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await this.startExclusive(targetVersion, route);
    } finally {
      release();
    }
  }

  private async startExclusive(
    targetVersion: string,
    route: GuardianUpdateRoute,
  ): Promise<StartGuardianUpdateResult> {
    const current = await loadState(this.options.file);
    const runningAge = current?.status === 'running'
      ? this.now().getTime() - Date.parse(current.startedAt)
      : 0;
    if (
      current?.status === 'running' &&
      Number.isFinite(runningAge) &&
      runningAge <= (this.options.runningTimeoutMs ?? 35 * 60_000)
    ) {
      return { accepted: false, reason: 'busy', id: current.id };
    }
    const id = this.id();
    const state: GuardianUpdateState = {
      schemaVersion: 1,
      id,
      status: 'running',
      packageName: this.options.packageName,
      targetVersion,
      dshProfile: this.options.dshProfile,
      route,
      startedAt: this.now().toISOString(),
    };
    await saveState(this.options.file, state);
    try {
      await this.launch({
        id,
        stateFile: this.options.file,
        packageName: this.options.packageName,
        targetVersion,
        dshProfile: this.options.dshProfile,
      });
    } catch (error) {
      await saveState(this.options.file, {
        ...state,
        status: 'failed',
        finishedAt: this.now().toISOString(),
        error: error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000),
        delivered: false,
      });
      throw error;
    }
    return { accepted: true, id };
  }

  /**
   * Resolve the intentional race where a managed service restart terminates
   * its detached worker in the same service cgroup. The freshly loaded
   * package version is authoritative evidence that replacement completed.
   */
  async reconcile(runningVersion: string): Promise<'unchanged' | 'succeeded' | 'failed'> {
    const state = await loadState(this.options.file);
    if (!state || state.status !== 'running') return 'unchanged';
    if (state.targetVersion === runningVersion) {
      await saveState(this.options.file, {
        ...state,
        status: 'succeeded',
        finishedAt: this.now().toISOString(),
        delivered: false,
      });
      return 'succeeded';
    }
    const age = this.now().getTime() - Date.parse(state.startedAt);
    if (Number.isFinite(age) && age > (this.options.runningTimeoutMs ?? 35 * 60_000)) {
      await saveState(this.options.file, {
        ...state,
        status: 'failed',
        finishedAt: this.now().toISOString(),
        error: 'update worker did not complete before the recovery deadline',
        delivered: false,
      });
      return 'failed';
    }
    return 'unchanged';
  }

  /** Deliver an update result once; failed delivery remains pending. */
  async deliverResult(
    deliver: (state: GuardianUpdateState) => Promise<void>,
  ): Promise<boolean> {
    const state = await loadState(this.options.file);
    if (!state || state.status === 'running' || state.delivered === true) return false;
    await deliver(state);
    const latest = await loadState(this.options.file);
    if (latest?.id === state.id && latest.status !== 'running') {
      await saveState(this.options.file, { ...latest, delivered: true });
    }
    return true;
  }
}
