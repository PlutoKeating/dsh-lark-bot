import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDocument } from 'yaml';
import {
  DEFAULT_SDK_PROFILE,
  ensureSdkProfile,
  isSdkProfileReady,
  patchYamlFor,
  resolveSdkLaunch,
  sdkProfileRoot,
  SDK_SERVER_PACKAGE,
  SDK_SERVER_VERSION,
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
    expect(patch).toContain("name: 'dsh-lark-bot/sdk-server'");
    expect(patch).toContain("id: lark-notify");
    expect(patch).toContain("id: lark-file");
    expect(patch).toContain("name: 'dsh-lark-bot/file'");
    expect(patch).toContain("id: lark-ask");
    expect(patch).toContain("name: 'dsh-lark-bot/ask'");
    expect(patch).toContain("id: lark-plan-approval");
    expect(patch).toContain('policyEndpoint: !!js process.env.DSH_LARK_APPROVAL_URL');
    expect(patch).toContain("name: 'dsh-lark-bot/plan'");
    expect(patch).toContain("id: lark-approval-answerer");
    expect(patch).toContain("name: 'dsh-lark-bot/approval'");
    expect(patch).toContain('use lark_request_plan_approval');
    expect(patch).toContain('The bridge policy treats one uncomposed shell call as read-only');
    expect(patch).toContain('do not try an equivalent command, tool, or path');
    expect(patch).toContain('use lark_ask_user and wait for the answer');
    expect(patch).toContain('[policy-denial layer=...]');
    expect(patch).toContain('uses lark_ask_user for interactive answers');
    // Regression guard (channel-skill bug): the model-invocable channel skill
    // must be mounted on the agent runtime context, not only the bridge engine.
    expect(patch).toContain('id: lark-skill');
    expect(patch).toContain("name: 'dsh-lark-bot/skill'");

    // The generated overlay must parse as valid YAML (guards the new row's
    // indentation against silently producing a malformed patch).
    const document = parseDocument(patch, {
      customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }],
    });
    expect(document.errors).toEqual([]);
  });

  it('omits the bridge tools from the core-only safe SDK overlay', () => {
    const patch = patchYamlFor({ bridgeTools: false });
    expect(patch).toContain("id: sdk-jsonrpc-server");
    expect(patch).toContain(`name: '${SDK_SERVER_PACKAGE}'`);
    expect(patch).not.toContain("name: 'dsh-lark-bot/sdk-server'");
    expect(patch).toContain('id: user-questions');
    expect(patch).not.toContain('id: lark-notify');
    expect(patch).not.toContain('id: lark-file');
    expect(patch).not.toContain('id: lark-ask');
    expect(patch).not.toContain('id: lark-plan-approval');
    expect(patch).not.toContain('id: lark-approval-answerer');
    expect(patch).not.toContain('use lark_request_plan_approval');
    // The channel skill is not a bridge callback tool, so it stays mounted in
    // the core-only safe overlay too (guardian recovery guidance).
    expect(patch).toContain('id: lark-skill');
    expect(patch).toContain("name: 'dsh-lark-bot/skill'");
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
          JSON.stringify({ name: SDK_SERVER_PACKAGE, version: SDK_SERVER_VERSION }),
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
      JSON.stringify({ name: SDK_SERVER_PACKAGE, version: SDK_SERVER_VERSION }),
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

  it('rewrites a stale managed overlay without reinstalling ready packages', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-home-overlay-'));
    tempDirs.push(home);
    const profileRoot = sdkProfileRoot(home, DEFAULT_SDK_PROFILE);
    const first = await ensureSdkProfile({
      home,
      install: async (root) => {
        const own = ownPackageInfo();
        await mkdir(join(root, 'node_modules', ...SDK_SERVER_PACKAGE.split('/')), {
          recursive: true,
        });
        await writeFile(
          join(root, 'node_modules', SDK_SERVER_PACKAGE, 'package.json'),
          JSON.stringify({ name: SDK_SERVER_PACKAGE, version: SDK_SERVER_VERSION }),
        );
        await symlink(own.root, join(root, 'node_modules', own.name), 'dir');
      },
    });
    expect(first.ok).toBe(true);
    await writeFile(join(profileRoot, 'cordis.patch.yml'), '[]\n');
    const install = vi.fn();
    const repaired = await ensureSdkProfile({ home, install });
    expect(repaired).toMatchObject({ ok: true, created: true });
    expect(install).not.toHaveBeenCalled();
    expect(await readFile(join(profileRoot, 'cordis.patch.yml'), 'utf8')).toBe(patchYamlFor());
  });

  it('rejects an otherwise complete profile with a stale server version', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-home-old-server-'));
    tempDirs.push(home);
    const profileRoot = sdkProfileRoot(home, DEFAULT_SDK_PROFILE);
    const own = ownPackageInfo();
    await mkdir(join(profileRoot, 'node_modules', ...SDK_SERVER_PACKAGE.split('/')), { recursive: true });
    await writeFile(
      join(profileRoot, 'node_modules', SDK_SERVER_PACKAGE, 'package.json'),
      JSON.stringify({ name: SDK_SERVER_PACKAGE, version: '0.1.0-rc.6' }),
    );
    await symlink(own.root, join(profileRoot, 'node_modules', own.name), 'dir');
    await writeFile(join(profileRoot, 'package.json'), '{}');
    await writeFile(join(profileRoot, 'cordis.yml'), '[]\n');
    await writeFile(join(profileRoot, 'cordis.patch.yml'), '[]\n');
    expect(isSdkProfileReady(profileRoot)).toBe(false);
  });

  it('forces pnpm to refresh a stale physical server package', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-home-corrupt-server-'));
    tempDirs.push(home);
    const profileRoot = sdkProfileRoot(home, DEFAULT_SDK_PROFILE);
    const own = ownPackageInfo();
    await mkdir(join(profileRoot, 'node_modules', ...SDK_SERVER_PACKAGE.split('/')), { recursive: true });
    await writeFile(
      join(profileRoot, 'node_modules', SDK_SERVER_PACKAGE, 'package.json'),
      JSON.stringify({ name: SDK_SERVER_PACKAGE, version: '0.1.0-rc.6' }),
    );
    await symlink(own.root, join(profileRoot, 'node_modules', own.name), 'dir');
    await writeFile(join(profileRoot, 'package.json'), '{}');
    await writeFile(join(profileRoot, 'cordis.yml'), '[]\n');
    await writeFile(join(profileRoot, 'cordis.patch.yml'), '[]\n');
    const install = vi.fn(async (root: string, options?: { force?: boolean }) => {
      if (!options?.force) return;
      await writeFile(
        join(root, 'node_modules', SDK_SERVER_PACKAGE, 'package.json'),
        JSON.stringify({ name: SDK_SERVER_PACKAGE, version: SDK_SERVER_VERSION }),
      );
    });

    await expect(ensureSdkProfile({ home, install })).resolves.toMatchObject({ ok: true });
    expect(install).toHaveBeenCalledWith(profileRoot, { force: true });
  });

  it('repairs the linked bridge package dependency tree when its SDK server is stale', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-home-stale-own-deps-'));
    tempDirs.push(home);
    const profileRoot = sdkProfileRoot(home, DEFAULT_SDK_PROFILE);
    const ownRoot = join(home, 'installed-dsh-lark-bot');
    const own = { name: 'dsh-lark-bot', root: ownRoot, version: '0.19.4' };
    await mkdir(join(ownRoot, 'node_modules', ...SDK_SERVER_PACKAGE.split('/')), { recursive: true });
    await writeFile(
      join(ownRoot, 'package.json'),
      JSON.stringify({ name: own.name, version: own.version, dsh: { bundle: { patch: './cordis.patch.yml' } } }),
    );
    await writeFile(join(ownRoot, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
    await writeFile(
      join(ownRoot, 'node_modules', SDK_SERVER_PACKAGE, 'package.json'),
      JSON.stringify({ name: SDK_SERVER_PACKAGE, version: '0.1.0-rc.6' }),
    );
    const installOwnDependencies = vi.fn(async (root: string, options?: { force?: boolean }) => {
      await writeFile(
        join(ownRoot, 'node_modules', SDK_SERVER_PACKAGE, 'package.json'),
        JSON.stringify({ name: SDK_SERVER_PACKAGE, version: SDK_SERVER_VERSION, main: 'index.js' }),
      );
      await writeFile(join(ownRoot, 'node_modules', SDK_SERVER_PACKAGE, 'index.js'), 'export {};\n');
      expect(root).toBe(ownRoot);
      expect(options).toEqual({ force: true });
    });

    const result = await ensureSdkProfile({
      home,
      ownPackage: own,
      installOwnDependencies,
      install: async (root) => {
        expect(root).toBe(profileRoot);
        await mkdir(join(root, 'node_modules', ...SDK_SERVER_PACKAGE.split('/')), { recursive: true });
        await writeFile(
          join(root, 'node_modules', SDK_SERVER_PACKAGE, 'package.json'),
          JSON.stringify({ name: SDK_SERVER_PACKAGE, version: SDK_SERVER_VERSION }),
        );
        await symlink(ownRoot, join(root, 'node_modules', own.name), 'dir');
      },
    });

    expect(result).toMatchObject({ ok: true });
    expect(installOwnDependencies).toHaveBeenCalledOnce();
  });

  it('accepts the npm/npx flat dependency layout without trying pnpm repair', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-home-npx-flat-'));
    tempDirs.push(home);
    const profileRoot = sdkProfileRoot(home, DEFAULT_SDK_PROFILE);
    const nodeModules = join(home, 'npx', 'node_modules');
    const ownRoot = join(nodeModules, 'dsh-lark-bot');
    const own = { name: 'dsh-lark-bot', root: ownRoot, version: '0.19.5' };
    await mkdir(ownRoot, { recursive: true });
    await mkdir(join(nodeModules, ...SDK_SERVER_PACKAGE.split('/')), { recursive: true });
    await writeFile(
      join(ownRoot, 'package.json'),
      JSON.stringify({ name: own.name, version: own.version, dsh: { bundle: { patch: './cordis.patch.yml' } } }),
    );
    await writeFile(
      join(nodeModules, SDK_SERVER_PACKAGE, 'package.json'),
      JSON.stringify({ name: SDK_SERVER_PACKAGE, version: SDK_SERVER_VERSION, main: 'index.js' }),
    );
    await writeFile(join(nodeModules, SDK_SERVER_PACKAGE, 'index.js'), 'export {};\n');
    await mkdir(join(profileRoot, 'node_modules', ...SDK_SERVER_PACKAGE.split('/')), { recursive: true });
    await writeFile(
      join(profileRoot, 'node_modules', SDK_SERVER_PACKAGE, 'package.json'),
      JSON.stringify({ name: SDK_SERVER_PACKAGE, version: SDK_SERVER_VERSION }),
    );
    await symlink(ownRoot, join(profileRoot, 'node_modules', own.name), 'dir');
    await writeFile(join(profileRoot, 'package.json'), '{}');
    await writeFile(join(profileRoot, 'cordis.yml'), '[]\n');
    await writeFile(join(profileRoot, 'cordis.patch.yml'), patchYamlFor());
    const install = vi.fn();
    const installOwnDependencies = vi.fn();

    await expect(ensureSdkProfile({
      home,
      ownPackage: own,
      install,
      installOwnDependencies,
    })).resolves.toMatchObject({ ok: true, created: false });
    expect(install).not.toHaveBeenCalled();
    expect(installOwnDependencies).not.toHaveBeenCalled();
  });

  it('resolves dependencies beside a pnpm package symlink target', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-home-pnpm-link-'));
    tempDirs.push(home);
    const profileRoot = sdkProfileRoot(home, DEFAULT_SDK_PROFILE);
    const profileNodeModules = join(home, 'installed-profile', 'node_modules');
    const physicalNodeModules = join(
      profileNodeModules,
      '.pnpm',
      'dsh-lark-bot@0.19.5_fixture',
      'node_modules',
    );
    const physicalOwnRoot = join(physicalNodeModules, 'dsh-lark-bot');
    const logicalOwnRoot = join(profileNodeModules, 'dsh-lark-bot');
    const own = { name: 'dsh-lark-bot', root: logicalOwnRoot, version: '0.19.5' };
    await mkdir(physicalOwnRoot, { recursive: true });
    await mkdir(join(physicalNodeModules, ...SDK_SERVER_PACKAGE.split('/')), { recursive: true });
    await writeFile(
      join(physicalOwnRoot, 'package.json'),
      JSON.stringify({ name: own.name, version: own.version, dsh: { bundle: { patch: './cordis.patch.yml' } } }),
    );
    await writeFile(
      join(physicalNodeModules, SDK_SERVER_PACKAGE, 'package.json'),
      JSON.stringify({ name: SDK_SERVER_PACKAGE, version: SDK_SERVER_VERSION, main: 'index.js' }),
    );
    await writeFile(join(physicalNodeModules, SDK_SERVER_PACKAGE, 'index.js'), 'export {};\n');
    await symlink(physicalOwnRoot, logicalOwnRoot, 'dir');

    await mkdir(join(profileRoot, 'node_modules', ...SDK_SERVER_PACKAGE.split('/')), { recursive: true });
    await writeFile(
      join(profileRoot, 'node_modules', SDK_SERVER_PACKAGE, 'package.json'),
      JSON.stringify({ name: SDK_SERVER_PACKAGE, version: SDK_SERVER_VERSION }),
    );
    await symlink(logicalOwnRoot, join(profileRoot, 'node_modules', own.name), 'dir');
    await writeFile(join(profileRoot, 'package.json'), '{}');
    await writeFile(join(profileRoot, 'cordis.yml'), '[]\n');
    await writeFile(join(profileRoot, 'cordis.patch.yml'), patchYamlFor());
    const install = vi.fn();
    const installOwnDependencies = vi.fn();

    await expect(ensureSdkProfile({
      home,
      ownPackage: own,
      install,
      installOwnDependencies,
    })).resolves.toMatchObject({ ok: true, created: false });
    expect(install).not.toHaveBeenCalled();
    expect(installOwnDependencies).not.toHaveBeenCalled();
  });

  it('does not let a matching hoisted package hide a stale profile-local copy', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-home-shadowed-server-'));
    tempDirs.push(home);
    const profileRoot = sdkProfileRoot(home, DEFAULT_SDK_PROFILE);
    const own = ownPackageInfo();
    await mkdir(join(profileRoot, 'node_modules', ...SDK_SERVER_PACKAGE.split('/')), { recursive: true });
    await mkdir(join(profileRoot, '..', 'node_modules', ...SDK_SERVER_PACKAGE.split('/')), { recursive: true });
    await writeFile(
      join(profileRoot, 'node_modules', SDK_SERVER_PACKAGE, 'package.json'),
      JSON.stringify({ name: SDK_SERVER_PACKAGE, version: '0.1.0-rc.6' }),
    );
    await writeFile(
      join(profileRoot, '..', 'node_modules', SDK_SERVER_PACKAGE, 'package.json'),
      JSON.stringify({ name: SDK_SERVER_PACKAGE, version: SDK_SERVER_VERSION }),
    );
    await symlink(own.root, join(profileRoot, 'node_modules', own.name), 'dir');
    await writeFile(join(profileRoot, 'package.json'), '{}');
    await writeFile(join(profileRoot, 'cordis.yml'), '[]\n');
    await writeFile(join(profileRoot, 'cordis.patch.yml'), '[]\n');

    expect(isSdkProfileReady(profileRoot)).toBe(false);
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

describe('patchYamlFor rollback compatibility', () => {
  it('omits rows for subpaths a rolled-back package does not export and falls back to the official server', async () => {
    const oldPkg = await mkdtemp(join(tmpdir(), 'old-sdk-pkg-'));
    tempDirs.push(oldPkg);
    const own = { name: 'dsh-lark-bot', root: oldPkg, version: '0.15.9' };
    await writeFile(join(oldPkg, 'package.json'), JSON.stringify({
      name: own.name,
      version: own.version,
      exports: {
        '.': './dist/index.js',
        './plugin': './dist/plugin.js',
        './notify': './dist/notify.js',
      },
    }));

    const patch = patchYamlFor({ own });
    // ./sdk-server is not exported, so fall back to the official server.
    expect(patch).toContain(`name: '${SDK_SERVER_PACKAGE}'`);
    expect(patch).not.toContain("name: 'dsh-lark-bot/sdk-server'");
    // Only exported subpaths are referenced.
    expect(patch).toContain("name: 'dsh-lark-bot/notify'");
    expect(patch).not.toContain("name: 'dsh-lark-bot/file'");
    expect(patch).not.toContain("name: 'dsh-lark-bot/secret'");
    expect(patch).not.toContain("name: 'dsh-lark-bot/ask'");
    expect(patch).not.toContain("name: 'dsh-lark-bot/plan'");
    expect(patch).not.toContain("name: 'dsh-lark-bot/approval'");
    expect(patch).not.toContain("name: 'dsh-lark-bot/skill'");
    expect(patch).not.toContain('id: lark-file');
    expect(patch).not.toContain('id: lark-approval-answerer');
  });

  it('treats a package with no exports field as allowing every subpath', async () => {
    const oldPkg = await mkdtemp(join(tmpdir(), 'no-exports-sdk-pkg-'));
    tempDirs.push(oldPkg);
    const own = { name: 'dsh-lark-bot', root: oldPkg, version: '0.15.9' };
    await writeFile(join(oldPkg, 'package.json'), JSON.stringify({ name: own.name, version: own.version }));

    const patch = patchYamlFor({ own });
    expect(patch).toContain("name: 'dsh-lark-bot/sdk-server'");
    expect(patch).toContain('id: lark-notify');
    expect(patch).toContain('id: lark-file');
    expect(patch).toContain('id: lark-ask');
    expect(patch).toContain('id: lark-plan-approval');
    expect(patch).toContain('id: lark-approval-answerer');
    expect(patch).toContain('id: lark-skill');
  });
});
