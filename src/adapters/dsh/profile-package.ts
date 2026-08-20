import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Verify the physical package used by a managed profile matches an exact pin. */
export function profilePackageMatches(
  profileRoot: string,
  packageName: string,
  expectedVersion: string,
): boolean {
  const candidates = [
    join(profileRoot, 'node_modules', packageName, 'package.json'),
    join(profileRoot, '..', 'node_modules', packageName, 'package.json'),
  ];
  for (const manifest of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as {
        name?: unknown;
        version?: unknown;
      };
      // Node resolves the profile-local package before the shared parent.
      // Once a physical manifest exists, its result is authoritative: a
      // stale local copy must not be hidden by a matching hoisted copy.
      return parsed.name === packageName && parsed.version === expectedVersion;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      return false;
    }
  }
  return false;
}
