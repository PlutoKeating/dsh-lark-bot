import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PublishManifest } from '../scripts/publish-bundle.mjs';
import {
  assemblePackage,
  collectRequiredDistFiles,
  validateDistCompleteness,
} from '../scripts/publish-bundle.mjs';

const DIST_FILES = [
  'index.js',
  'index.d.ts',
  'index.js.map',
  'cli.js',
  'cli.d.ts',
  'cli.js.map',
  'plugin.js',
  'plugin.d.ts',
  'plugin.js.map',
  'invariant.js',
  'invariant.d.ts',
  'invariant.js.map',
  'notify.js',
  'notify.d.ts',
  'notify.js.map',
  'ask.js',
  'ask.d.ts',
  'ask.js.map',
] as const;

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const FAKE_PATCH = [
  '# dsh-lark-bot as a profile bundle.',
  '',
  '- insert:',
  '    - id: dsh-lark-bot',
  "      name: 'dsh-lark-bot/plugin'",
  '      config: {}',
  '',
  '    - id: lark-notify',
  "      name: 'dsh-lark-bot/notify'",
  '      config: {}',
  '',
].join('\n');

function manifestFor(name = 'dsh-lark-bot'): PublishManifest {
  return {
    name,
    version: '0.9.1',
    type: 'module',
    bin: { [name]: `bin/${name}.mjs` },
    exports: {
      '.': { types: './dist/index.d.ts', import: './dist/index.js' },
      './plugin': { types: './dist/plugin.d.ts', import: './dist/plugin.js' },
      './invariant': { types: './dist/invariant.d.ts', import: './dist/invariant.js' },
      './notify': { types: './dist/notify.d.ts', import: './dist/notify.js' },
      './ask': { types: './dist/ask.d.ts', import: './dist/ask.js' },
    },
    files: ['dist', 'bin', 'cordis.patch.yml', 'README.md', 'SECURITY.md', 'LICENSE'],
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    scripts: { build: 'tsup' },
    devDependencies: { typescript: '^5.6.3' },
  };
}

async function makeFakeRoot(distFiles: readonly string[] = DIST_FILES, name = 'dsh-lark-bot') {
  const root = await mkdtemp(join(tmpdir(), 'publish-bundle-'));
  tempRoots.push(root);
  await mkdir(join(root, 'dist'), { recursive: true });
  await Promise.all([
    ...distFiles.map((file) => writeFile(join(root, 'dist', file), 'export const fixture = true;\n')),
    writeFile(join(root, 'README.md'), '# fixture\n'),
    writeFile(join(root, 'SECURITY.md'), 'security\n'),
    writeFile(join(root, 'LICENSE'), 'AGPL-3.0\n'),
    writeFile(join(root, 'cordis.patch.yml'), FAKE_PATCH),
    writeFile(join(root, 'package.json'), `${JSON.stringify(manifestFor(name), null, 2)}\n`),
  ]);
  return root;
}

describe('publish bundle', () => {
  it('assembles a package containing every dist artifact', async () => {
    const root = await makeFakeRoot();
    const dir = await assemblePackage({ root, name: 'dsh-lark-bot' });
    tempRoots.push(dir);
    for (const file of DIST_FILES) {
      expect(existsSync(join(dir, 'dist', file)), `dist/${file}`).toBe(true);
    }
    const manifest = JSON.parse(
      await readFile(join(dir, 'package.json'), 'utf8'),
    ) as PublishManifest;
    expect(manifest.name).toBe('dsh-lark-bot');
    expect(manifest.files).toContain('dist');
    expect(manifest.scripts).toBeUndefined();
    const bin = await readFile(join(dir, 'bin', 'dsh-lark-bot.mjs'), 'utf8');
    expect(bin).toContain("import { main } from '../dist/cli.js';");
    const patch = await readFile(join(dir, 'cordis.patch.yml'), 'utf8');
    expect(patch).toContain("name: 'dsh-lark-bot/plugin'");
    expect(patch).toContain("name: 'dsh-lark-bot/notify'");
    // The primary package ships the repository file verbatim: the published
    // patch can never drift from the tracked cordis.patch.yml.
    expect(patch).toBe(FAKE_PATCH);
  });

  it('requires the ask entry that was missing from the v0.9.0 publish', async () => {
    const required = collectRequiredDistFiles(manifestFor());
    expect(required).toContain('ask.js');
    expect(required).toContain('ask.d.ts');
  });

  it('fails validation and assembly when an exported artifact is missing', async () => {
    const root = await makeFakeRoot(DIST_FILES.filter((file) => file !== 'ask.js'));
    const manifest = JSON.parse(
      await readFile(join(root, 'package.json'), 'utf8'),
    ) as PublishManifest;
    expect(() => validateDistCompleteness(join(root, 'dist'), manifest)).toThrow(/ask\.js/);
    await expect(assemblePackage({ root, name: 'dsh-lark-bot' })).rejects.toThrow(/ask\.js/);
  });

  it('generates the dual package under its own name and bin', async () => {
    const root = await makeFakeRoot(DIST_FILES, 'dsh-feishu-bot');
    const dir = await assemblePackage({ root, name: 'dsh-feishu-bot' });
    tempRoots.push(dir);
    const manifest = JSON.parse(
      await readFile(join(dir, 'package.json'), 'utf8'),
    ) as PublishManifest;
    expect(manifest.name).toBe('dsh-feishu-bot');
    expect(manifest.bin).toEqual({ 'dsh-feishu-bot': 'bin/dsh-feishu-bot.mjs' });
    expect(existsSync(join(dir, 'bin', 'dsh-feishu-bot.mjs'))).toBe(true);
    const patch = await readFile(join(dir, 'cordis.patch.yml'), 'utf8');
    expect(patch).toContain("name: 'dsh-feishu-bot/plugin'");
    expect(patch).toContain("name: 'dsh-feishu-bot/notify'");
    // The plugin id stays dsh-lark-bot for the aliased package.
    expect(patch).toContain('- id: dsh-lark-bot');
    expect(patch).not.toContain("name: 'dsh-lark-bot/plugin'");
  });
});
