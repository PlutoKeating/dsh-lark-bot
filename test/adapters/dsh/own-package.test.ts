import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  findOwnPackageRoot,
  ownPackageInfo,
} from '../../../src/adapters/dsh/own-package.js';
import { isSdkProfileReady } from '../../../src/adapters/dsh/sdk-runtime.js';
import { sdkProfileRoot } from '../../../src/adapters/dsh/sdk-runtime.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('ownPackageInfo', () => {
  it('resolves the package root from bundled (dist/cli.js-like) depth', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-own-'));
    tempDirs.push(root);
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ name: 'dsh-lark-bot', version: '0.6.0' }),
    );
    const dist = join(root, 'dist');
    await mkdir(dist, { recursive: true });

    const info = findOwnPackageRoot(dist);
    expect(info.name).toBe('dsh-lark-bot');
    expect(info.root).toBe(root);
  });

  it('resolves the package root from unbundled (dist/adapters/dsh) depth', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-own-'));
    tempDirs.push(root);
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ name: 'dsh-feishu-bot', version: '0.6.0' }),
    );
    const deep = join(root, 'dist', 'adapters', 'dsh');
    await mkdir(deep, { recursive: true });

    const info = findOwnPackageRoot(deep);
    expect(info.name).toBe('dsh-feishu-bot');
    expect(info.root).toBe(root);
  });
});

describe('runtime profile package link readiness', () => {
  it('rejects a broken link target (the /home regression)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-link-'));
    tempDirs.push(home);
    const profileRoot = sdkProfileRoot(home, 'dsh-lark');
    const nodeModules = join(profileRoot, 'node_modules');
    await mkdir(nodeModules, { recursive: true });
    // Simulate the bug: node_modules/dsh-lark-bot points at a directory
    // without a matching package.json (e.g. the filesystem root).
    await symlink('/home', join(nodeModules, 'dsh-lark-bot'), 'dir');

    expect(isSdkProfileReady(profileRoot)).toBe(false);
  });

  it('accepts a link whose target is the real package', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-link-'));
    tempDirs.push(home);
    const profileRoot = sdkProfileRoot(home, 'dsh-lark');
    const nodeModules = join(profileRoot, 'node_modules');
    await mkdir(nodeModules, { recursive: true });
    await symlink(ownPackageInfo().root, join(nodeModules, 'dsh-lark-bot'), 'dir');
    await writeFile(join(profileRoot, 'package.json'), '{}', 'utf8');
    await writeFile(join(profileRoot, 'cordis.yml'), '[]\n', 'utf8');
    await writeFile(join(profileRoot, 'cordis.patch.yml'), '[]\n', 'utf8');
    await mkdir(join(nodeModules, '@deepseek-ai', 'dsh-sdk-jsonrpc-server'), {
      recursive: true,
    });

    expect(isSdkProfileReady(profileRoot)).toBe(true);
  });

  it('rejects a stale link to an older copy with the same name and patch', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-link-'));
    const staleRoot = await mkdtemp(join(tmpdir(), 'dsh-link-stale-'));
    tempDirs.push(home, staleRoot);
    await writeFile(
      join(staleRoot, 'package.json'),
      JSON.stringify({
        name: 'dsh-lark-bot',
        version: '0.9.0',
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      }),
    );
    const profileRoot = sdkProfileRoot(home, 'dsh-lark');
    const nodeModules = join(profileRoot, 'node_modules');
    await mkdir(nodeModules, { recursive: true });
    await symlink(staleRoot, join(nodeModules, 'dsh-lark-bot'), 'dir');
    await writeFile(join(profileRoot, 'package.json'), '{}', 'utf8');
    await writeFile(join(profileRoot, 'cordis.yml'), '[]\n', 'utf8');
    await writeFile(join(profileRoot, 'cordis.patch.yml'), '[]\n', 'utf8');
    await mkdir(join(nodeModules, '@deepseek-ai', 'dsh-sdk-jsonrpc-server'), {
      recursive: true,
    });

    expect(isSdkProfileReady(profileRoot)).toBe(false);
  });
});
