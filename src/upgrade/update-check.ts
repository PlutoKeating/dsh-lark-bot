import { ownPackageInfo } from '../adapters/dsh/own-package.js';
import { compareVersions, fetchNpmLatestVersionOnce } from './versions.js';

/**
 * Cheap, cached npm-latest lookup shared by the `/version` command and the
 * bridge update notifier (issue #15). The result is cached in memory so a
 * user-triggered `/version` and the periodic notifier never hammer the
 * registry. `DSH_LARK_UPGRADE_CHECK=0` disables probing entirely.
 */

export const UPDATE_CHECK_CACHE_MS = 60 * 60_000;

/**
 * How long a *failed* lookup stays cached before the next probe re-runs.
 * A transient registry blip (e.g. a cold npm `/latest` response crossing the
 * per-request timeout) must never be misreported as an outage for the full
 * success cache window, or `/version` would keep saying "unavailable" for an
 * hour even though the registry is reachable (issue #110).
 */
export const UPDATE_CHECK_FAILURE_CACHE_MS = 15_000;

interface UpdateCheckCache {
  at: number;
  latest: string | undefined;
  /** True when `latest` is undefined: the last lookup failed (cached briefly). */
  failed: boolean;
  /** Versions already announced by the notifier (dedupe). */
  notified: Set<string>;
}

let cache: UpdateCheckCache | undefined;

export function upgradeCheckEnabled(): boolean {
  return (process.env.DSH_LARK_UPGRADE_CHECK ?? '1') !== '0';
}

/**
 * The version of the running package. Returns an empty string when the running
 * version cannot be resolved (never a misleading sentinel like `'unknown'`),
 * so callers can treat "unknown current" explicitly and never compare it as a
 * real version.
 */
export function currentVersion(): string {
  return ownPackageInfo().version ?? '';
}

/** True when `latest` is a strictly newer release than `current`. */
export function isNewer(latest: string | undefined, current: string): boolean {
  if (latest === undefined) return false;
  if (current === '') return false; // unknown current: never claim an update
  return compareVersions(latest, current) > 0;
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
  if (cache !== undefined) {
    // An explicit `cacheMs` (e.g. `/new`'s `0`) is honored literally so callers
    // that want a fresh probe re-run it (+ asynchronously refreshes the cache).
    // Otherwise a failure is remembered only briefly while a success keeps the
    // full window — a registry hiccup must not stick as "unavailable" (issue #110).
    const ttl =
      options.cacheMs !== undefined
        ? options.cacheMs
        : cache.failed
          ? UPDATE_CHECK_FAILURE_CACHE_MS
          : UPDATE_CHECK_CACHE_MS;
    if (now - cache.at < ttl) return cache.latest;
  }
  const probe = options.probe ?? fetchNpmLatestVersionOnce;
  const latest = await probe(options.packageName ?? ownPackageInfo().name);
  cache = {
    at: now,
    latest,
    failed: latest === undefined,
    notified: cache?.notified ?? new Set<string>(),
  };
  return latest;
}

/** Mark `latest` as announced; returns true the first time for this version. */
export function markNotified(latest: string): boolean {
  if (cache === undefined) cache = { at: 0, latest, failed: false, notified: new Set<string>() };
  if (cache.notified.has(latest)) return false;
  cache.notified.add(latest);
  return true;
}

/** Test seam: drop the cached latest + notified set. */
export function resetUpdateCheckCache(): void {
  cache = undefined;
}
