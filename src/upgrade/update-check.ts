import { ownPackageInfo } from '../adapters/dsh/own-package.js';
import { compareVersions, fetchNpmLatestVersionOnce } from './versions.js';

/**
 * Cheap, cached npm-latest lookup shared by the `/version` command and the
 * bridge update notifier (issue #15). The result is cached in memory so a
 * user-triggered `/version` and the periodic notifier never hammer the
 * registry. `DSH_LARK_UPGRADE_CHECK=0` disables probing entirely.
 */

export const UPDATE_CHECK_CACHE_MS = 60 * 60_000;

interface UpdateCheckCache {
  at: number;
  latest: string | undefined;
  /** Versions already announced by the notifier (dedupe). */
  notified: Set<string>;
}

let cache: UpdateCheckCache | undefined;

export function upgradeCheckEnabled(): boolean {
  return (process.env.DSH_LARK_UPGRADE_CHECK ?? '1') !== '0';
}

export function currentVersion(): string {
  return ownPackageInfo().version ?? 'unknown';
}

/** True when `latest` is a strictly newer release than `current`. */
export function isNewer(latest: string | undefined, current: string): boolean {
  return latest !== undefined && compareVersions(latest, current) > 0;
}

/**
 * Resolve the npm latest version, honoring the in-memory cache and the
 * `DSH_LARK_UPGRADE_CHECK` switch. Returns undefined when disabled,
 * unreachable or unknown — callers must treat it as "unknown", never fatal.
 */
export async function latestVersion(
  options: {
    packageName?: string;
    cacheMs?: number;
    probe?: (packageName: string) => Promise<string | undefined>;
  } = {},
): Promise<string | undefined> {
  if (!upgradeCheckEnabled()) return undefined;
  const now = Date.now();
  if (cache !== undefined && now - cache.at < (options.cacheMs ?? UPDATE_CHECK_CACHE_MS)) {
    return cache.latest;
  }
  const probe = options.probe ?? fetchNpmLatestVersionOnce;
  const latest = await probe(options.packageName ?? ownPackageInfo().name);
  cache = { at: now, latest, notified: cache?.notified ?? new Set<string>() };
  return latest;
}

/** Mark `latest` as announced; returns true the first time for this version. */
export function markNotified(latest: string): boolean {
  if (cache === undefined) cache = { at: 0, latest, notified: new Set<string>() };
  if (cache.notified.has(latest)) return false;
  cache.notified.add(latest);
  return true;
}

/** Test seam: drop the cached latest + notified set. */
export function resetUpdateCheckCache(): void {
  cache = undefined;
}
