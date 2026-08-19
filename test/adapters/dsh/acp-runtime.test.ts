import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ACP_PACKAGE,
  ACP_VERSION,
  DEFAULT_ACP_PROFILE,
  acpPatchYaml,
  acpProfileRoot,
  ensureAcpProfile,
  isAcpManagedProfileCurrent,
  isAcpProfileReady,
  resolveAcpLaunch,
} from '../../../src/adapters/dsh/acp-runtime.js';
import { ownPackageInfo } from '../../../src/adapters/dsh/own-package.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function installPlugin(root: string) {
  return async (): Promise<void> => {
    const own = ownPackageInfo();
    const pluginRoot = join(root, 'node_modules', ...ACP_PACKAGE.split('/'));
    await mkdir(pluginRoot, { recursive: true });
    await writeFile(
      join(pluginRoot, 'package.json'),
      JSON.stringify({ name: ACP_PACKAGE, version: ACP_VERSION }),
    );
    await symlink(own.root, join(root, 'node_modules', own.name), 'dir');
  };
}

describe('resolveAcpLaunch', () => {
  it('writes the runtime overlay with the notify and ask tools', () => {
    const patch = acpPatchYaml('deepseek-official', 'deepseek-v4-flash');
    expect(patch).toContain("id: acp");
    expect(patch).toContain("id: lark-notify");
    expect(patch).toContain("id: lark-ask");
    expect(patch).toContain("name: 'dsh-lark-bot/ask'");
    expect(patch).toContain("id: lark-plan-approval");
    expect(patch).toContain("name: 'dsh-lark-bot/plan'");
    expect(patch).not.toContain('id: lark-approval-answerer');
    expect(patch).toContain('use lark_request_plan_approval');
  });

  it('resolves the discovered bin with the ACP profile', () => {
    const launch = resolveAcpLaunch({ home: '/home/x', bin: '/home/x/bin.js' });
    expect(launch.args).toEqual(['/home/x/bin.js', '--profile', DEFAULT_ACP_PROFILE]);
  });

  it('honours explicit overrides', () => {
    const launch = resolveAcpLaunch({ home: '/home/x', command: 'dsh', args: ['--profile', 'acp-custom'] });
    expect(launch.args).toEqual(['--profile', 'acp-custom']);
  });
});

describe('ensureAcpProfile', () => {
  it('creates the profile, installs the plugin and writes the provider/model patch', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-acp-home-'));
    tempDirs.push(home);
    const root = acpProfileRoot(home, DEFAULT_ACP_PROFILE);
    const result = await ensureAcpProfile({
      home,
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      install: installPlugin(root),
    });
    expect(result.ok).toBe(true);
    expect(result.created).toBe(true);
    expect(isAcpProfileReady(root)).toBe(true);
    expect(isAcpManagedProfileCurrent(root, 'deepseek-official', 'deepseek-v4-flash')).toBe(true);
    expect(isAcpManagedProfileCurrent(root, 'other-provider', 'deepseek-v4-flash')).toBe(false);
    expect(acpPatchYaml('deepseek-official', 'deepseek-v4-flash')).toContain(
      'provider: deepseek-official',
    );
  });

  it('self-heals a partially created profile (missing patch)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-acp-partial-'));
    tempDirs.push(home);
    const root = acpProfileRoot(home, DEFAULT_ACP_PROFILE);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'package.json'), '{}', 'utf8');
    await writeFile(join(root, 'cordis.yml'), '[]\n', 'utf8');
    await installPlugin(root)();

    const result = await ensureAcpProfile({
      home,
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      install: async () => undefined,
    });
    expect(result.ok).toBe(true);
    expect(isAcpProfileReady(root)).toBe(true);
  });

  it('repairs a stale own-package link after an upgrade', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-acp-stale-'));
    tempDirs.push(home);
    const root = acpProfileRoot(home, DEFAULT_ACP_PROFILE);
    const own = ownPackageInfo();

    // Old copy that declares our name and bundle patch but is not the running
    // package root — exactly the upgrade scenario that broke v0.9.0 installs.
    await mkdir(join(root, 'node_modules', ...ACP_PACKAGE.split('/')), { recursive: true });
    await writeFile(
      join(root, 'node_modules', ACP_PACKAGE, 'package.json'),
      JSON.stringify({ name: ACP_PACKAGE, version: ACP_VERSION }),
    );
    await mkdir(join(root, 'node_modules', own.name), { recursive: true });
    await writeFile(
      join(root, 'node_modules', own.name, 'package.json'),
      JSON.stringify({
        name: own.name,
        version: '0.9.0',
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      }),
    );
    await writeFile(join(root, 'package.json'), '{}', 'utf8');
    await writeFile(join(root, 'cordis.yml'), '[]\n', 'utf8');

    expect(isAcpProfileReady(root)).toBe(false);

    const result = await ensureAcpProfile({
      home,
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      install: async (installRoot) => {
        await rm(join(installRoot, 'node_modules', own.name), { recursive: true, force: true });
        await symlink(own.root, join(installRoot, 'node_modules', own.name), 'dir');
      },
    });
    expect(result.ok).toBe(true);
    expect(isAcpProfileReady(root)).toBe(true);
  });

  it('reports install failures', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-acp-fail-'));
    tempDirs.push(home);
    const result = await ensureAcpProfile({
      home,
      install: async () => {
        throw new Error('registry unreachable');
      },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('registry unreachable');
  });

  it('rejects an otherwise complete profile with a stale ACP version', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-acp-old-version-'));
    tempDirs.push(home);
    const root = acpProfileRoot(home, DEFAULT_ACP_PROFILE);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'package.json'), '{}');
    await writeFile(join(root, 'cordis.yml'), '[]\n');
    await writeFile(join(root, 'cordis.patch.yml'), '[]\n');
    await installPlugin(root)();
    await writeFile(
      join(root, 'node_modules', ACP_PACKAGE, 'package.json'),
      JSON.stringify({ name: ACP_PACKAGE, version: '0.1.0-rc.6' }),
    );
    expect(isAcpProfileReady(root)).toBe(false);
  });
});
