import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export interface OwnPackageInfo {
  name: string;
  root: string;
  /** Version from the resolved package.json (absent for the cwd fallback). */
  version?: string;
}

/**
 * Locate the running dsh-lark-bot package (source checkout or installed
 * dist). The managed dsh runtime profiles link this package in so their patch
 * rows (`dsh-lark-bot/notify`, …) resolve through the profile's node_modules.
 *
 * Primary source of truth: the package.json co-located with this module (one
 * level up: `<packageRoot>/dist/<module>.js`), exactly the resolution used by
 * `cli.ts`'s `packageVersion()` for `--version`. That is the running package's
 * own manifest and can never "step on" a stale or foreign package.json that an
 * upward filesystem walk might otherwise match first (the `/new` `0.9.0` bug).
 *
 * The upward walk is retained only as a fallback for unbundled source layouts
 * where `../package.json` from the module directory is not our own manifest.
 */
export function ownPackageInfo(): OwnPackageInfo {
  return resolveOwnPackage(dirname(fileURLToPath(import.meta.url)));
}

/**
 * Resolve the running package starting from `startDir` (the directory that
 * holds this module): prefer the sibling package.json, then fall back to the
 * upward walk. Extracted for testability.
 */
export function resolveOwnPackage(startDir: string): OwnPackageInfo {
  const coLocated = readOwnPackageAt(join(startDir, '..', 'package.json'));
  if (coLocated !== undefined) return coLocated;
  return findOwnPackageRoot(startDir);
}

/**
 * Walk upward from `startDir` until a package.json whose name is one of ours
 * is found. Extracted for testability; bundled and unbundled layouts both
 * resolve to the package root. Because a *stale* copy of our package can
 * masquerade as the running one, callers should prefer the co-located
 * resolution (`resolveOwnPackage`) and rely on this walk only as a fallback.
 */
export function findOwnPackageRoot(startDir: string): OwnPackageInfo {
  let dir = startDir;
  for (let depth = 0; depth < 8; depth += 1) {
    const pkg = readOwnPackageAt(join(dir, 'package.json'));
    if (pkg !== undefined) return pkg;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: the canonical name and the current working directory.
  return { name: 'dsh-lark-bot', root: process.cwd() };
}

/** Read a package.json and return it only when it is one of our own packages. */
function readOwnPackageAt(pkgPath: string): OwnPackageInfo | undefined {
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      name?: unknown;
      version?: unknown;
    };
    if (typeof pkg.name === 'string' && isOwnPackageName(pkg.name)) {
      const info: OwnPackageInfo = { name: pkg.name, root: dirname(pkgPath) };
      if (typeof pkg.version === 'string') info.version = pkg.version;
      return info;
    }
  } catch {
    // Not a readable manifest at this path; try the next candidate.
  }
  return undefined;
}

function isOwnPackageName(name: string): boolean {
  return (
    name === 'dsh-lark-bot' ||
    name === 'dsh-feishu-bot' ||
    /^@[^/]+\/(dsh-lark-bot|dsh-feishu-bot)$/.test(name)
  );
}
