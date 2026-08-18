#!/usr/bin/env node
// Upstream upgrade radar: reports npm latest/next independently and compares
// the exact pin with the highest published version. DSH prerelease package
// dist-tags are not synchronized, so `latest` alone is not authoritative.
//
// Usage:
//   node scripts/check-dsh-upstream.mjs            # informational (exit 0)
//   node scripts/check-dsh-upstream.mjs --fail-on-upgrade
import { readDshCompatibility } from './dsh-compat.mjs';

const failOnUpgrade = process.argv.includes('--fail-on-upgrade');
const compat = readDshCompatibility();

const PACKAGES = [
  ['@deepseek-ai/dsh', compat.harness],
  ['@deepseek-ai/dsh-sdk-client', compat.sdkClient],
  ['@deepseek-ai/dsh-sdk-jsonrpc-server', compat.sdkServer],
  ['@deepseek-ai/dsh-acp', compat.acp],
];

function assertNoDrift() {
  let mismatch = PACKAGES.some(([name, pinned]) => {
    if (name === '@deepseek-ai/dsh-sdk-client' && pinned !== compat.packageSdkClient) {
      console.error(
        `drift: dsh-compat.ts sdkClient=${pinned} but package.json pins ${compat.packageSdkClient}`,
      );
      return true;
    }
    return false;
  });
  if (compat.packageDshTools !== undefined) {
    console.error(
      'drift: package.json must not directly depend on @deepseek-ai/dsh-tools; raw host-registry tools avoid a second Symbol realm',
    );
    mismatch = true;
  }
  if (
    !Array.isArray(compat.workshopDshVersions) ||
    !compat.workshopDshVersions.includes(compat.harness)
  ) {
    console.error(
      `drift: dshWorkshop.compatibility.dshVersions does not include ${compat.harness}`,
    );
    mismatch = true;
  }
  if (compat.legacyRc6LockEntries.length > 0) {
    console.error(
      `drift: lockfile still mixes rc.6 core packages into the rc.7 graph: ${compat.legacyRc6LockEntries.join(', ')}`,
    );
    mismatch = true;
  }
  if (mismatch) process.exit(1);
}

async function registryVersions(name) {
  const response = await fetch(`https://registry.npmjs.org/${name}`, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`registry lookup failed for ${name}: HTTP ${response.status}`);
  }
  const document = await response.json();
  return {
    latest: document['dist-tags']?.latest,
    next: document['dist-tags']?.next,
    highest: Object.keys(document.versions ?? {}).reduce((best, version) =>
      compareVersions(version, best) > 0 ? version : best,
    ),
  };
}

/**
 * Minimal semver comparison for `X.Y.Z[-prerelease]` versions. Prereleases
 * sort below the same core release, and `rc.N` compares by its numeric suffix.
 */
function compareVersions(a, b) {
  const [coreA = '0.0.0', preA] = a.split('-');
  const [coreB = '0.0.0', preB] = b.split('-');
  const partsA = coreA.split('.').map(Number);
  const partsB = coreB.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const diff = (partsA[index] ?? 0) - (partsB[index] ?? 0);
    if (diff !== 0) return diff;
  }
  if (preA !== undefined && preB === undefined) return -1;
  if (preA === undefined && preB !== undefined) return 1;
  if (preA === undefined && preB === undefined) return 0;
  const numberA = Number.parseInt(preA.replace(/^[^0-9]*/, ''), 10) || 0;
  const numberB = Number.parseInt(preB.replace(/^[^0-9]*/, ''), 10) || 0;
  if (numberA !== numberB) return numberA - numberB;
  return preA.localeCompare(preB);
}

async function main() {
  assertNoDrift();
  console.log(`compat matrix verified at ${compat.verifiedAt} (node ${compat.node})`);
  console.log('package                    pinned           npm latest       npm next         highest published');
  let newer = false;
  for (const [name, pinned] of PACKAGES) {
    const { latest, next, highest } = await registryVersions(name);
    const upgrade = highest !== undefined && compareVersions(highest, pinned) > 0;
    newer ||= upgrade;
    const lagNote =
      latest !== undefined && pinned !== undefined && compareVersions(latest, pinned) < 0
        ? '  (npm latest lags behind pinned)'
        : '';
    console.log(
      `${name.padEnd(26)} ${String(pinned).padEnd(15)} ${String(latest ?? '(unknown)').padEnd(16)} ${String(next ?? '(unknown)').padEnd(16)} ${String(highest ?? '(unknown)')}${upgrade ? '  <-- newer release' : ''}${lagNote}`,
    );
  }
  if (newer) {
    console.log('\nA newer release exists. Follow docs/COMPATIBILITY.md to upgrade.');
    if (failOnUpgrade) process.exitCode = 1;
  } else {
    console.log('\nAll pinned versions match the highest published release.');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
