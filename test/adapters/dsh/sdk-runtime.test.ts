import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SDK_PROFILE,
  ensureSdkProfile,
  isSdkProfileReady,
  patchYamlFor,
  resolveSdkLaunch,
  sdkProfileRoot,
  SDK_SERVER_PACKAGE,
} from '../../../src/adapters/dsh/sdk-runtime.js';
import { ownPackageInfo } from '../../../src/adapters/dsh/own-package.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('resolveSdkLaunch', () => {
  it('writes the runtime overlay with the notify and ask tools', () => {
    const patch = patchYamlFor();
    expect(patch).toContain("id: sdk-jsonrpc-server");
    expect(patch).toContain("id: lark-notify");
    expect(patch).toContain("id: lark-ask");
    expect(patch).toContain("name: 'dsh-lark-bot/ask'");
  });

  it('omits the bridge tools from the core-only safe SDK overlay', () => {
    const patch = patchYamlFor({ bridgeTools: false });
    expect(patch).toContain("id: sdk-jsonrpc-server");
    expect(patch).toContain('id: user-questions');
    expect(patch).not.toContain('id: lark-notify');
    expect(patch).not.toContain('id: lark-ask');
  });

  it('uses the discovered bin with the SDK profile', () => {
    const launch = resolveSdkLaunch({ home: '/home/x', bin: '/home/x/bin.js' });
    expect(launch.command).toBe('node');
    expect(launch.args).toEqual(['/home/x/bin.js', '--profile', DEFAULT_SDK_PROFILE]);
  });

  it('honours explicit command overrides', () => {
    const launch = resolveSdkLaunch({ home: '/home/x', command: 'dsh', args: ['--profile', 'custom'] });
    expect(launch.args).toEqual(['--profile', 'custom']);
  });
});

describe('ensureSdkProfile', () => {
  it('creates the managed profile and installs the server plugin', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-home-'));
    tempDirs.push(home);
    const profileRoot = sdkProfileRoot(home, DEFAULT_SDK_PROFILE);
    expect(isSdkProfileReady(profileRoot)).toBe(false);

    const result = await ensureSdkProfile({
      home,
      install: async (root) => {
        const own = ownPackageInfo();
        await mkdir(join(root, 'node_modules', '@deepseek-ai', SDK_SERVER_PACKAGE.split('/')[1] ?? ''), {
          recursive: true,
        });
        await writeFile(
          join(root, 'node_modules', SDK_SERVER_PACKAGE, 'package.json'),
          JSON.stringify({ name: SDK_SERVER_PACKAGE }),
        );
        await symlink(own.root, join(root, 'node_modules', own.name), 'dir');
      },
    });

    expect(result.ok).toBe(true);
    expect(result.created).toBe(true);
    expect(isSdkProfileReady(profileRoot)).toBe(true);
    expect(await ensureSdkProfile({ home })).toMatchObject({ ok: true, created: false });
  });

  it('repairs a stale own-package link after an upgrade', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-home-stale-'));
    tempDirs.push(home);
    const profileRoot = sdkProfileRoot(home, DEFAULT_SDK_PROFILE);
    const own = ownPackageInfo();

    // Simulate an old install: a different copy that still declares our name
    // and bundle patch, plus the server plugin and profile skeleton.
    await mkdir(join(profileRoot, 'node_modules', own.name), { recursive: true });
    await writeFile(
      join(profileRoot, 'node_modules', own.name, 'package.json'),
      JSON.stringify({
        name: own.name,
        version: '0.9.0',
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      }),
    );
    await mkdir(join(profileRoot, 'node_modules', ...SDK_SERVER_PACKAGE.split('/')), {
      recursive: true,
    });
    await writeFile(
      join(profileRoot, 'node_modules', SDK_SERVER_PACKAGE, 'package.json'),
      JSON.stringify({ name: SDK_SERVER_PACKAGE }),
    );
    await writeFile(join(profileRoot, 'package.json'), '{}', 'utf8');
    await writeFile(join(profileRoot, 'cordis.yml'), '[]\n', 'utf8');
    await writeFile(join(profileRoot, 'cordis.patch.yml'), '[]\n', 'utf8');

    expect(isSdkProfileReady(profileRoot)).toBe(false);

    const result = await ensureSdkProfile({
      home,
      install: async (root) => {
        await rm(join(root, 'node_modules', own.name), { recursive: true, force: true });
        await symlink(own.root, join(root, 'node_modules', own.name), 'dir');
      },
    });
    expect(result.ok).toBe(true);
    expect(result.created).toBe(true);
    expect(isSdkProfileReady(profileRoot)).toBe(true);
  });

  it('reports install failures', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-home-fail-'));
    tempDirs.push(home);
    const result = await ensureSdkProfile({
      home,
      install: async () => {
        throw new Error('offline');
      },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('offline');
  });
});
