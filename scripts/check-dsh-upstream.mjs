#!/usr/bin/env node
// Upstream upgrade radar: compares the pinned DeepSeek Harness versions with
// the npm `latest` (stable) dist-tag and reports any newer stable release.
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
  const mismatch = PACKAGES.some(([name, pinned]) => {
    if (name === '@deepseek-ai/dsh-sdk-client' && pinned !== compat.packageSdkClient) {
      console.error(
        `drift: dsh-compat.ts sdkClient=${pinned} but package.json pins ${compat.packageSdkClient}`,
      );
      return true;
    }
    return false;
  });
  if (mismatch) process.exit(1);
}

async function latestStable(name) {
  const response = await fetch(`https://registry.npmjs.org/${name}`, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`registry lookup failed for ${name}: HTTP ${response.status}`);
  }
  const document = await response.json();
  return {
    latest: document['dist-tags']?.latest,
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
  console.log('package                    pinned           npm latest       highest published');
  let newer = false;
  for (const [name, pinned] of PACKAGES) {
    const { latest, highest } = await latestStable(name);
    const upgrade = highest !== undefined && compareVersions(highest, pinned) > 0;
    newer ||= upgrade;
    const lagNote =
      latest !== undefined && pinned !== undefined && compareVersions(latest, pinned) < 0
        ? '  (npm latest lags behind pinned)'
        : '';
    console.log(
      `${name.padEnd(26)} ${String(pinned).padEnd(15)} ${String(latest ?? '(unknown)').padEnd(16)} ${String(highest ?? '(unknown)')}${upgrade ? '  <-- newer release' : ''}${lagNote}`,
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
