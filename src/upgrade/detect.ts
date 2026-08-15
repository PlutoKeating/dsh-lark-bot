/**
 * Read-only detection of the current installation state for `dsh-lark-bot
 * upgrade`: which package version is installed in the dsh profile, which
 * version the running CLI is, whether the dsh profile / guardian / bridge are
 * currently up, and where the guardian service entry lives.
 *
 * Nothing here mutates anything — the command composes these facts to decide
 * what (if anything) needs upgrading and how to surface running-instance
 * guidance safely.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { ownPackageInfo, type OwnPackageInfo } from '../adapters/dsh/own-package.js';
import { resolveAppPaths } from '../config/app-paths.js';
import { resolveDshHome } from '../config/dsh-runtime.js';
import {
  listProcesses,
  matchProfileProcess,
  type ProfileProcess,
} from '../guardian/process.js';
import {
  guardianServiceFilePath,
  guardianStatePath,
} from '../guardian/install.js';
import { existsSync } from 'node:fs';
import {
  loadGuardianState,
  newGuardianState,
  type GuardianState,
} from '../guardian/state.js';
import {
  isHeartbeatFresh,
  readHeartbeat,
} from '../guardian/heartbeat.js';

export interface InstalledPackageInfo {
  name: string;
  version: string;
  root: string;
}

export interface GuardianStatus {
  /** Service entry (systemd unit / LaunchAgent / Windows startup .cmd) exists. */
  installed: boolean;
  /** A live `… guardian run` process was found. */
  running: boolean;
  /** Persisted guardian state (profile mapping), when readable. */
  state: GuardianState | undefined;
}

export interface UpgradeDetection {
  /** The CLI package currently executing this command. */
  own: OwnPackageInfo;
  /** The package version installed inside the dsh profile (if any). */
  installed: InstalledPackageInfo | undefined;
  dshHome: string;
  profile: string;
  /** A running `dsh --profile <name>` process, if any. */
  profileProcess: ProfileProcess | undefined;
  guardian: GuardianStatus;
  /** Whether the bridge engine heartbeat in the bridge profile is fresh. */
  heartbeatFresh: boolean;
  bridgeProfile: string;
}

export interface DetectUpgradeStateOptions {
  profile?: string;
  dshHome?: string;
  larkHome?: string;
  /** Root for guardian service-entry / state paths (defaults to homedir; tests). */
  guardianRoot?: string;
  /** Injectable process lister (tests). */
  listProcessesFn?: typeof listProcesses;
  /** Heartbeat staleness threshold (default 15s, mirroring the guardian). */
  staleMs?: number;
  now?: () => number;
}

/**
 * Read the installed package manifest from the profile's node_modules.
 * Follows symlinks, so both pnpm layouts and direct installs resolve.
 */
export async function readInstalledPackage(
  dshHome: string,
  profile: string,
  packageName: string,
): Promise<InstalledPackageInfo | undefined> {
  const manifest = join(
    dshHome,
    'profiles',
    profile,
    'node_modules',
    packageName,
    'package.json',
  );
  try {
    const raw = await readFile(manifest, 'utf8');
    const parsed = JSON.parse(raw) as { name?: unknown; version?: unknown };
    if (typeof parsed.name !== 'string' || typeof parsed.version !== 'string') {
      return undefined;
    }
    return { name: parsed.name, version: parsed.version, root: join(manifest, '..') };
  } catch {
    return undefined;
  }
}

function looksLikeGuardianRun(cmdline: string): boolean {
  return cmdline.includes('guardian') && /(?:^|\s)run(?:\s|$)/.test(cmdline);
}

export async function detectUpgradeState(
  options: DetectUpgradeStateOptions = {},
): Promise<UpgradeDetection> {
  const own = ownPackageInfo();
  const home = options.guardianRoot ?? homedir();
  const dshHome = options.dshHome ?? resolveDshHome(home, process.env);
  const profile = options.profile ?? 'dsh-lark';
  const larkHome = options.larkHome ?? resolveAppPaths().root;
  const bridgeProfile = process.env.DSH_LARK_GUARDIAN_BRIDGE_PROFILE ?? 'default';

  const installed = await readInstalledPackage(dshHome, profile, own.name);
  const list = options.listProcessesFn ?? listProcesses;
  const processes = await list();
  const profileProcess = processes.find((entry) =>
    matchProfileProcess(entry.cmdline, profile),
  );
  const guardianRunning = processes.some((entry) =>
    looksLikeGuardianRun(entry.cmdline),
  );
  const stateFile = guardianStatePath(home);
  const guardianState = await loadGuardianState(
    stateFile,
    newGuardianState({ dshProfile: profile }),
  ).catch(() => undefined);

  const heartbeatFile = join(
    larkHome,
    'profiles',
    bridgeProfile,
    'guardian',
    'heartbeat.json',
  );
  const heartbeat = await readHeartbeat(heartbeatFile);
  const now = options.now ?? Date.now;
  const heartbeatFresh = isHeartbeatFresh(
    heartbeat,
    options.staleMs ?? 15_000,
    now(),
  );

  return {
    own,
    installed,
    dshHome,
    profile,
    profileProcess,
    guardian: {
      installed: existsSync(guardianServiceFilePath(process.platform, home)),
      running: guardianRunning,
      state: guardianState,
    },
    heartbeatFresh,
    bridgeProfile,
  };
}
