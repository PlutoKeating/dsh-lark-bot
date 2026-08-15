import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { repairRuntimeProfiles } from '../../src/upgrade/runtime.js';
import { ownPackageInfo } from '../../src/adapters/dsh/own-package.js';
import {
  DEFAULT_SDK_PROFILE,
  isSdkProfileReady,
  sdkProfileRoot,
} from '../../src/adapters/dsh/sdk-runtime.js';
import { DEFAULT_ACP_PROFILE } from '../../src/adapters/dsh/acp-runtime.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-runtime-'));
  tempDirs.push(home);
  return home;
}

/** Build a provisioned-looking SDK profile with a STALE own-package copy. */
async function buildSdkProfileWithStaleLink(home: string): Promise<void> {
  const root = sdkProfileRoot(home, DEFAULT_SDK_PROFILE);
  const own = ownPackageInfo();
  await mkdir(join(root, 'node_modules', own.name), { recursive: true });
  await writeFile(
    join(root, 'node_modules', own.name, 'package.json'),
    JSON.stringify({
      name: own.name,
      version: '0.9.0',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }),
  );
  await mkdir(join(root, 'node_modules', '@deepseek-ai', 'dsh-sdk-jsonrpc-server'), {
    recursive: true,
  });
  await writeFile(
    join(root, 'node_modules', '@deepseek-ai', 'dsh-sdk-jsonrpc-server', 'package.json'),
    JSON.stringify({ name: '@deepseek-ai/dsh-sdk-jsonrpc-server' }),
  );
  await writeFile(join(root, 'package.json'), '{}', 'utf8');
  await writeFile(join(root, 'cordis.yml'), '[]\n', 'utf8');
  await writeFile(join(root, 'cordis.patch.yml'), '[]\n', 'utf8');
}

describe('repairRuntimeProfiles', () => {
  it('skips profiles that were never provisioned', async () => {
    const home = await makeHome();
    const states = await repairRuntimeProfiles({ dshHome: home });
    expect(states).toEqual([
      { profile: DEFAULT_SDK_PROFILE, existed: false, repaired: false, ok: true },
      { profile: DEFAULT_ACP_PROFILE, existed: false, repaired: false, ok: true },
    ]);
  });

  it('relinks a stale own-package copy after an upgrade', async () => {
    const home = await makeHome();
    await buildSdkProfileWithStaleLink(home);
    const own = ownPackageInfo();
    const sdkRoot = sdkProfileRoot(home, DEFAULT_SDK_PROFILE);
    expect(isSdkProfileReady(sdkRoot)).toBe(false);

    const states = await repairRuntimeProfiles({ dshHome: home });

    const sdk = states.find((s) => s.profile === DEFAULT_SDK_PROFILE);
    expect(sdk).toMatchObject({ existed: true, repaired: true, ok: true });
    // The link now resolves to the running package root.
    const link = join(sdkRoot, 'node_modules', own.name);
    expect(realpathSync(link)).toBe(realpathSync(own.root));
    expect(isSdkProfileReady(sdkRoot)).toBe(true);
    // The ACP profile was never provisioned.
    expect(states.find((s) => s.profile === DEFAULT_ACP_PROFILE)).toMatchObject({
      existed: false,
    });
  });

  it('leaves an already-ready profile untouched', async () => {
    const home = await makeHome();
    await buildSdkProfileWithStaleLink(home);
    const own = ownPackageInfo();
    const sdkRoot = sdkProfileRoot(home, DEFAULT_SDK_PROFILE);
    // Point the link at the running root directly -> ready.
    await rm(join(sdkRoot, 'node_modules', own.name), { recursive: true, force: true });
    await symlink(own.root, join(sdkRoot, 'node_modules', own.name), 'dir');

    const states = await repairRuntimeProfiles({ dshHome: home });
    expect(states.find((s) => s.profile === DEFAULT_SDK_PROFILE)).toMatchObject({
      existed: true,
      repaired: false,
      ok: true,
    });
  });

  it('reports not-ok when the profile is broken beyond the link', async () => {
    const home = await makeHome();
    const sdkRoot = sdkProfileRoot(home, DEFAULT_SDK_PROFILE);
    // Skeleton + stale link, but NO server plugin installed.
    await mkdir(join(sdkRoot, 'node_modules'), { recursive: true });
    await writeFile(join(sdkRoot, 'package.json'), '{}', 'utf8');
    await writeFile(join(sdkRoot, 'cordis.yml'), '[]\n', 'utf8');
    await writeFile(join(sdkRoot, 'cordis.patch.yml'), '[]\n', 'utf8');

    const states = await repairRuntimeProfiles({ dshHome: home });
    expect(states.find((s) => s.profile === DEFAULT_SDK_PROFILE)).toMatchObject({
      existed: true,
      repaired: true,
      ok: false,
    });
  });
});
