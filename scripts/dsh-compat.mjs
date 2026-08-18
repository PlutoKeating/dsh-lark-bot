// Shared reader for the DeepSeek Harness compatibility matrix.
// `src/config/dsh-compat.ts` is the single source of truth; this reader keeps
// shell-side tooling (upstream watcher, CI probe) in sync with it without
// loading TypeScript at runtime.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function readDshCompatibility() {
  const packageJson = JSON.parse(
    readFileSync(join(ROOT, 'package.json'), 'utf8'),
  );
  const source = readFileSync(join(ROOT, 'src', 'config', 'dsh-compat.ts'), 'utf8');
  const lockfile = readFileSync(join(ROOT, 'pnpm-lock.yaml'), 'utf8');
  const get = (key) => source.match(new RegExp(`\\b${key}:\\s*'([^']+)'`))?.[1];
  return {
    harness: get('harness'),
    sdkClient: get('sdkClient'),
    sdkServer: get('sdkServer'),
    acp: get('acp'),
    node: get('node'),
    verifiedAt: get('verifiedAt'),
    packageSdkClient: packageJson.dependencies?.['@deepseek-ai/dsh-sdk-client'],
    packageDshTools: packageJson.dependencies?.['@deepseek-ai/dsh-tools'],
    workshopDshVersions: packageJson.dshWorkshop?.compatibility?.dshVersions,
    legacyRc6LockEntries: [...new Set(
      lockfile.match(/@deepseek-ai\/dsh-[a-z0-9-]+@0\.1\.0-rc\.6/g) ?? [],
    )],
  };
}

export function rootDir() {
  return ROOT;
}
