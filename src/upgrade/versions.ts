/**
 * Version parsing / comparison and npm `latest` discovery for the
 * one-command upgrade path (`dsh-lark-bot upgrade`).
 *
 * Kept dependency-free (global `fetch`) so the upgrade command works from
 * any installed package shape: source checkout, bundled `dist/cli.js`, the
 * profile's `node_modules` link or an `npx` cache copy.
 */

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** Optional prerelease tag after `-`, e.g. `rc.1` (`1.2.3-rc.1`). */
  prerelease?: string;
}

/** Default npm registry; override with `DSH_LARK_UPGRADE_REGISTRY` (mirrors). */
export function defaultRegistryUrl(): string {
  return process.env.DSH_LARK_UPGRADE_REGISTRY?.trim() || 'https://registry.npmjs.org';
}

/**
 * Parse a semver-ish version (`x.y.z` with an optional `-prerelease`).
 * A leading `v` is tolerated. Returns undefined for unparsable input.
 */
export function parseVersion(value: string): ParsedVersion | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value.trim());
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    ...(match[4] ? { prerelease: match[4] } : {}),
  };
}

/**
 * Compare two version strings. Returns -1 / 0 / 1. Unparsable versions fall
 * back to a lexical comparison so the function never throws.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) {
    return a === b ? 0 : a < b ? -1 : 1;
  }
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1;
  }
  // Prerelease sorts before the release it belongs to: 1.0.0-rc.1 < 1.0.0.
  if (pa.prerelease === pb.prerelease) return 0;
  if (pa.prerelease === undefined) return 1;
  if (pb.prerelease === undefined) return -1;
  return pa.prerelease < pb.prerelease ? -1 : 1;
}

/** True when `to` is strictly newer than `from`. */
export function isVersionUpgrade(from: string, to: string): boolean {
  return compareVersions(to, from) > 0;
}

/**
 * Resolve the npm `latest` dist-tag version for a package. Returns undefined
 * when the registry is unreachable or the package/version is unknown, so the
 * caller can fall back to the running package version (`--force`).
 */
export async function fetchNpmLatestVersion(
  packageName: string,
  registryUrl: string = defaultRegistryUrl(),
  fetcher: typeof fetch = fetch,
): Promise<string | undefined> {
  try {
    const response = await fetcher(
      `${registryUrl}/${encodeURIComponent(packageName)}/latest`,
      {
        headers: { accept: 'application/vnd.npm.install-v1+json' },
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) return undefined;
    const body = (await response.json()) as { version?: unknown };
    return typeof body.version === 'string' ? body.version : undefined;
  } catch {
    return undefined;
  }
}

/** Build a deterministic `name@version` spec for `dsh plugin add`. */
export function packageSpecFor(name: string, version: string): string {
  return `${name}@${version}`;
}
