import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export interface OwnPackageInfo {
  name: string;
  root: string;
}

/**
 * Locate the running dsh-lark-bot package (source checkout or installed
 * dist). The managed dsh runtime profiles link this package in so their patch
 * rows (`dsh-lark-bot/notify`, …) resolve through the profile's node_modules.
 *
 * The module may be bundled (e.g. `dist/cli.js`) or unbundled
 * (`dist/adapters/.../sdk-runtime.js`), so the package root cannot be derived
 * from a fixed `import.meta.url` depth: walk upward until a package.json
 * whose name is one of ours is found.
 */
export function ownPackageInfo(): OwnPackageInfo {
  return findOwnPackageRoot(dirname(fileURLToPath(import.meta.url)));
}

/**
 * Walk upward from `startDir` until a package.json whose name is one of ours
 * is found. Extracted for testability; bundled and unbundled layouts both
 * resolve to the package root.
 */
export function findOwnPackageRoot(startDir: string): OwnPackageInfo {
  let dir = startDir;
  for (let depth = 0; depth < 8; depth += 1) {
    const pkgPath = join(dir, 'package.json');
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
        name?: unknown;
      };
      if (typeof pkg.name === 'string' && isOwnPackageName(pkg.name)) {
        return { name: pkg.name, root: dir };
      }
    } catch {
      // Not a readable manifest at this level; keep walking upward.
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: the canonical name and the current working directory.
  return { name: 'dsh-lark-bot', root: process.cwd() };
}

function isOwnPackageName(name: string): boolean {
  return (
    name === 'dsh-lark-bot' ||
    name === 'dsh-feishu-bot' ||
    /^@[^/]+\/(dsh-lark-bot|dsh-feishu-bot)$/.test(name)
  );
}
