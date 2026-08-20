#!/usr/bin/env node

// Shared publish-bundle assembly and validation, used by:
//   - scripts/publish-dual-packages.mjs (npm / GitHub Packages publish)
//   - scripts/check-publish-bundle.mjs (standalone dist completeness check)
//
// v0.9.0 shipped a broken tarball: the publish script hand-copied a fixed
// list of dist files and forgot the `ask` entry, while package.json exports
// declared `./ask` — every dsh profile boot that mounted lark-ask then died
// with ERR_MODULE_NOT_FOUND. To make that class of bug impossible, the
// published package is assembled from the WHOLE dist directory and validated
// before publish: every `exports` subpath and the CLI `bin` entry must exist
// in the assembled bundle, otherwise the publish aborts.

import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Publish manifest `files` entries; dist is copied wholesale. */
export const PUBLISH_FILES = [
  'dist',
  'bin',
  'cordis.patch.yml',
  'README.md',
  'README_EN.md',
  'SECURITY.md',
  'LICENSE',
];

/**
 * The cordis bundle patch shipped inside the package, sourced directly from
 * the repository's `cordis.patch.yml` so the published patch can never drift
 * from the tracked file. The primary package ships the file verbatim; the
 * dual package (dsh-feishu-bot) substitutes its own name in the module paths
 * and comments while keeping the plugin id (`dsh-lark-bot`) unchanged, exactly
 * like the old inline template did.
 */
export async function bundlePatchFor(root, name, packageName = name) {
  const source = await readFile(join(root, 'cordis.patch.yml'), 'utf8');
  if (name === 'dsh-lark-bot') return source;
  return source
    .split('\n')
    .map((line) =>
      line.trimStart().startsWith('- id: ')
        ? line
        : line.replaceAll('dsh-lark-bot', name),
    )
    .join('\n');
}

/** Recursively copy every file from src into dest (creating dest if needed). */
export async function copyDirRecursive(src, dest) {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const srcPath = join(src, entry.name);
      const destPath = join(dest, entry.name);
      if (entry.isDirectory()) {
        await copyDirRecursive(srcPath, destPath);
      } else {
        await copyFile(srcPath, destPath);
      }
    }),
  );
}

/**
 * The artifacts consumers can reach through package.json: every `exports`
 * subpath target (import / types / default) plus the CLI entry that
 * bin/<name>.mjs imports. Relative `./dist/x.js` targets are normalized to
 * `x.js` for filesystem checks relative to the dist directory.
 */
export function collectRequiredDistFiles(pkg) {
  const required = new Set(['cli.js']);
  const add = (value) => {
    if (typeof value === 'string' && value.startsWith('./dist/')) {
      required.add(value.slice('./dist/'.length));
    }
  };
  for (const target of Object.values(pkg.exports ?? {})) {
    if (typeof target === 'string') {
      add(target);
    } else if (target && typeof target === 'object') {
      add(target.types);
      add(target.import);
      add(target.default);
    }
  }
  return [...required].sort();
}

/**
 * Fail the release if any required artifact is missing from distDir.
 * Returns the resolved artifact list on success; throws with a per-file
 * report otherwise.
 */
export function validateDistCompleteness(distDir, pkg, options = {}) {
  const label = options.label ?? 'dist';
  const required = collectRequiredDistFiles(pkg);
  const missing = required.filter((rel) => !existsSync(join(distDir, rel)));
  if (missing.length > 0) {
    throw new Error(
      `[publish-bundle] ${label} is missing ${missing.length} artifact(s) required by ` +
        'package.json exports/bin:\n' +
        missing.map((rel) => `  - ${rel}`).join('\n') +
        '\nRun `pnpm build` and make sure every exported entry has a matching ' +
        'tsup entry before publishing.',
    );
  }
  return required;
}

/**
 * Assemble one publishable package in a fresh temp dir (or `dir` when given):
 * copies the whole dist directory, ships README/SECURITY/LICENSE, generates
 * the per-name cordis patch and bin shim, writes the published manifest and
 * validates the bundle before returning its path. The caller owns cleanup.
 */
export async function assemblePackage({ root, name, githubScope, dir }) {
  const rootPkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const { scripts, devDependencies, ...publishedManifest } = rootPkg;
  const packageName = githubScope ? `@${githubScope.toLowerCase()}/${name}` : name;
  const manifest = {
    ...publishedManifest,
    name: packageName,
    bin: { [name]: `bin/${name}.mjs` },
    files: [...PUBLISH_FILES],
  };

  const dest = dir ?? (await mkdtemp(join(tmpdir(), `${name}-`)));
  const distDest = join(dest, 'dist');
  await mkdir(distDest, { recursive: true });
  await copyDirRecursive(join(root, 'dist'), distDest);
  const clientPath = join(distDest, 'client.js');
  if (publishedManifest.dsh?.client && existsSync(clientPath)) {
    const client = await readFile(clientPath, 'utf8');
    const marker = 'window.__ModuleLoader__.load({ id: "dsh-lark-bot"';
    if (!client.includes(marker)) {
      throw new Error('[publish-bundle] dist/client.js is missing the expected module-loader id marker');
    }
    await writeFile(
      clientPath,
      client.replace(marker, `window.__ModuleLoader__.load({ id: ${JSON.stringify(packageName)}`),
      'utf8',
    );
  }
  await Promise.all([
    copyFile(join(root, 'README.md'), join(dest, 'README.md')),
    copyFile(join(root, 'README_EN.md'), join(dest, 'README_EN.md')),
    copyFile(join(root, 'SECURITY.md'), join(dest, 'SECURITY.md')),
    copyFile(join(root, 'LICENSE'), join(dest, 'LICENSE')),
  ]);
  await writeFile(
    join(dest, 'cordis.patch.yml'),
    await bundlePatchFor(root, name, packageName),
    'utf8',
  );

  await mkdir(join(dest, 'bin'), { recursive: true });
  await writeFile(
    join(dest, 'bin', `${name}.mjs`),
    ['#!/usr/bin/env node', "import { main } from '../dist/cli.js';", '', 'await main();', ''].join(
      '\n',
    ),
  );

  await writeFile(join(dest, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  validateDistCompleteness(distDest, manifest);
  return dest;
}
