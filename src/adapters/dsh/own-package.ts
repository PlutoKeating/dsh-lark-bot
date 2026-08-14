import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export interface OwnPackageInfo {
  name: string;
  root: string;
}

/**
 * Locate the running dsh-lark-bot package (source checkout or installed
 * dist). The managed dsh runtime profiles link this package in so their patch
 * rows (`dsh-lark-bot/notify`, …) resolve through the profile's node_modules.
 */
export function ownPackageInfo(): OwnPackageInfo {
  const root = fileURLToPath(new URL('../../..', import.meta.url));
  let name = 'dsh-lark-bot';
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      name?: unknown;
    };
    if (typeof pkg.name === 'string' && pkg.name) name = pkg.name;
  } catch {
    // Default to the canonical package name when the manifest is unreadable.
  }
  return { name, root };
}
