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
  SDK_SERVER_VERSION,
} from '../../src/adapters/dsh/sdk-runtime.js';
import {
  ACP_PACKAGE,
  ACP_VERSION,
  acpProfileRoot,
  DEFAULT_ACP_PROFILE,
  isAcpProfileReady,
} from '../../src/adapters/dsh/acp-runtime.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-runtime-'));
  tempDirs.push(home);
  return home;
}

function sdkRoot(home: string): string {
  return sdkProfileRoot(home, DEFAULT_SDK_PROFILE, { DSH_HOME: home });
}

function acpRoot(home: string): string {
  return acpProfileRoot(home, DEFAULT_ACP_PROFILE, { DSH_HOME: home });
}

/** Build a provisioned-looking SDK profile with a STALE own-package copy. */
async function buildSdkProfileWithStaleLink(
  home: string,
  serverVersion: string = SDK_SERVER_VERSION,
): Promise<void> {
  const root = sdkRoot(home);
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
    JSON.stringify({ name: '@deepseek-ai/dsh-sdk-jsonrpc-server', version: serverVersion }),
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
    const root = sdkRoot(home);
    expect(isSdkProfileReady(root)).toBe(false);

    const states = await repairRuntimeProfiles({ dshHome: home });

    const sdk = states.find((s) => s.profile === DEFAULT_SDK_PROFILE);
    expect(sdk).toMatchObject({ existed: true, repaired: true, ok: true });
    // The link now resolves to the running package root.
    const link = join(root, 'node_modules', own.name);
    expect(realpathSync(link)).toBe(realpathSync(own.root));
    expect(isSdkProfileReady(root)).toBe(true);
    // The ACP profile was never provisioned.
    expect(states.find((s) => s.profile === DEFAULT_ACP_PROFILE)).toMatchObject({
      existed: false,
    });
  });

  it('leaves an already-ready profile untouched', async () => {
    const home = await makeHome();
    await buildSdkProfileWithStaleLink(home);
    const own = ownPackageInfo();
    const root = sdkRoot(home);
    // Point the link at the running root directly -> ready.
    await rm(join(root, 'node_modules', own.name), { recursive: true, force: true });
    await symlink(own.root, join(root, 'node_modules', own.name), 'dir');

    const states = await repairRuntimeProfiles({ dshHome: home });
    expect(states.find((s) => s.profile === DEFAULT_SDK_PROFILE)).toMatchObject({
      existed: true,
      repaired: false,
      ok: true,
    });
  });

  it('re-provisions an existing profile whose upstream runtime is stale', async () => {
    const home = await makeHome();
    await buildSdkProfileWithStaleLink(home, '0.1.0-rc.6');
    const root = sdkRoot(home);
    const ensureSdkFn = async () => {
      await writeFile(
        join(root, 'node_modules', '@deepseek-ai', 'dsh-sdk-jsonrpc-server', 'package.json'),
        JSON.stringify({ name: '@deepseek-ai/dsh-sdk-jsonrpc-server', version: SDK_SERVER_VERSION }),
      );
      return { ok: true, created: true };
    };

    const states = await repairRuntimeProfiles({ dshHome: home, ensureSdkFn });

    expect(states.find((s) => s.profile === DEFAULT_SDK_PROFILE)).toMatchObject({
      existed: true,
      repaired: true,
      ok: true,
    });
    expect(isSdkProfileReady(root)).toBe(true);
  });

  it('preserves the managed ACP route while re-provisioning its stale runtime', async () => {
    const home = await makeHome();
    const root = acpRoot(home);
    const own = ownPackageInfo();
    await mkdir(join(root, 'node_modules', own.name), { recursive: true });
    await writeFile(
      join(root, 'node_modules', own.name, 'package.json'),
      JSON.stringify({ name: own.name, version: '0.9.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }),
    );
    await mkdir(join(root, 'node_modules', ...ACP_PACKAGE.split('/')), { recursive: true });
    await writeFile(
      join(root, 'node_modules', ACP_PACKAGE, 'package.json'),
      JSON.stringify({ name: ACP_PACKAGE, version: '0.1.0-rc.6' }),
    );
    await writeFile(join(root, 'package.json'), '{}');
    await writeFile(join(root, 'cordis.yml'), '[]\n');
    await writeFile(join(root, 'cordis.patch.yml'), '    provider: custom-gateway\n    model: custom-model\n');

    const ensureAcpFn: NonNullable<Parameters<typeof repairRuntimeProfiles>[0]['ensureAcpFn']> = async (options) => {
      expect(options.provider).toBe('custom-gateway');
      expect(options.model).toBe('custom-model');
      await writeFile(
        join(root, 'node_modules', ACP_PACKAGE, 'package.json'),
        JSON.stringify({ name: ACP_PACKAGE, version: ACP_VERSION }),
      );
      return { ok: true, created: true };
    };

    const states = await repairRuntimeProfiles({ dshHome: home, ensureAcpFn });

    expect(states.find((s) => s.profile === DEFAULT_ACP_PROFILE)).toMatchObject({
      existed: true,
      repaired: true,
      ok: true,
    });
    expect(isAcpProfileReady(root)).toBe(true);
  });

  it('reports not-ok when the profile is broken beyond the link', async () => {
    const home = await makeHome();
    const root = sdkRoot(home);
    // Skeleton + stale link, but NO server plugin installed.
    await mkdir(join(root, 'node_modules'), { recursive: true });
    await writeFile(join(root, 'package.json'), '{}', 'utf8');
    await writeFile(join(root, 'cordis.yml'), '[]\n', 'utf8');
    await writeFile(join(root, 'cordis.patch.yml'), '[]\n', 'utf8');

    const states = await repairRuntimeProfiles({
      dshHome: home,
      ensureSdkFn: async () => ({ ok: false, created: false, error: 'install failed' }),
    });
    expect(states.find((s) => s.profile === DEFAULT_SDK_PROFILE)).toMatchObject({
      existed: true,
      repaired: true,
      ok: false,
    });
  });
});
