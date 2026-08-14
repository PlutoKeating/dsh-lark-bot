import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ACP_PACKAGE,
  DEFAULT_ACP_PROFILE,
  acpPatchYaml,
  acpProfileRoot,
  ensureAcpProfile,
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
    await writeFile(join(pluginRoot, 'package.json'), JSON.stringify({ name: ACP_PACKAGE }));
    await mkdir(join(root, 'node_modules', own.name), { recursive: true });
  };
}

describe('resolveAcpLaunch', () => {
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
});
