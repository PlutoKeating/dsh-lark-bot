import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { writeFileAtomic } from '../platform/atomic-write.js';

/**
 * Persistent guardian state (`~/.dsh-lark/guardian.json`).
 *
 * The guardian is a separate minimal process, so everything it needs to
 * resume after a restart lives here:
 *  - which dsh profile to watch / relaunch and which bridge profile provides
 *    the Feishu credentials and access lists;
 *  - whether the dsh profile was ever observed up (the takeover gate: we only
 *    occupy the Feishu channel after the profile has actually run);
 *  - the current mode (`standby` / `takeover` / `safe`).
 */

export type GuardianMode = 'standby' | 'takeover' | 'safe';

export interface GuardianState {
  schemaVersion: 1;
  dshProfile: string;
  bridgeProfile: string;
  safeProfile: string;
  /** True once the dsh profile was observed running (heartbeat or process). */
  profileSeenUp: boolean;
  mode: GuardianMode;
  /** PID of the full-profile relaunch spawned when exiting safe mode. */
  relaunchedPid?: number | undefined;
  updatedAt: string;
}

export const DEFAULT_DSH_PROFILE = 'dsh-lark';
export const DEFAULT_BRIDGE_PROFILE = 'default';

export function defaultSafeProfile(dshProfile: string): string {
  return `${dshProfile}-safe`;
}

export function newGuardianState(input: {
  dshProfile?: string;
  bridgeProfile?: string;
}): GuardianState {
  const dshProfile = input.dshProfile ?? DEFAULT_DSH_PROFILE;
  return {
    schemaVersion: 1,
    dshProfile,
    bridgeProfile: input.bridgeProfile ?? DEFAULT_BRIDGE_PROFILE,
    safeProfile: defaultSafeProfile(dshProfile),
    profileSeenUp: false,
    mode: 'standby',
    updatedAt: new Date().toISOString(),
  };
}

export async function loadGuardianState(
  file: string,
  fallback: GuardianState,
): Promise<GuardianState> {
  try {
    const raw = await readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as Partial<GuardianState>;
    if (parsed.schemaVersion !== 1) return fallback;
    const dshProfile = typeof parsed.dshProfile === 'string' ? parsed.dshProfile : fallback.dshProfile;
    const bridgeProfile =
      typeof parsed.bridgeProfile === 'string' ? parsed.bridgeProfile : fallback.bridgeProfile;
    return {
      schemaVersion: 1,
      dshProfile,
      bridgeProfile,
      safeProfile:
        typeof parsed.safeProfile === 'string'
          ? parsed.safeProfile
          : defaultSafeProfile(dshProfile),
      profileSeenUp: parsed.profileSeenUp === true || fallback.profileSeenUp === true,
      mode: parsed.mode === 'takeover' || parsed.mode === 'safe' ? parsed.mode : 'standby',
      relaunchedPid:
        typeof parsed.relaunchedPid === 'number' ? parsed.relaunchedPid : undefined,
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    return fallback;
  }
}

export async function saveGuardianState(
  file: string,
  state: GuardianState,
): Promise<void> {
  const next: GuardianState = { ...state, updatedAt: new Date().toISOString() };
  await mkdir(dirname(file), { recursive: true });
  await writeFileAtomic(file, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
}

/** Mutate a copy of the state and persist it; used for small updates. */
export async function updateGuardianState(
  file: string,
  state: GuardianState,
  patch: Partial<GuardianState>,
): Promise<GuardianState> {
  const next: GuardianState = { ...state, ...patch };
  await saveGuardianState(file, next);
  return next;
}
