#!/usr/bin/env node

// Publishes the dual npm packages (dsh-lark-bot / dsh-feishu-bot) from a
// single root manifest. Each package is assembled by scripts/publish-bundle.mjs,
// which copies the WHOLE dist directory and validates that every `exports`
// subpath plus the CLI entry actually ships — a missing artifact (like the
// `ask` entry in v0.9.0) aborts the publish instead of shipping a broken
// tarball.

import { spawn } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { assemblePackage } from './publish-bundle.mjs';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const PACKAGE_NAMES = ['dsh-lark-bot', 'dsh-feishu-bot'];

const dryRun = process.argv.includes('--dry-run');
const skipPublish = process.argv.includes('--skip-publish');
const github = process.argv.includes('--github');
const packDirArgIndex = process.argv.indexOf('--pack-dir');
const packDir =
  packDirArgIndex >= 0 ? resolve(process.argv[packDirArgIndex + 1] ?? 'release-artifacts') : undefined;

function run(command, args, cwd) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      env: process.env,
    });
    child.once('error', rejectPromise);
    child.once('exit', (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        rejectPromise(new Error(`${command} exited with code ${String(code)}`));
      }
    });
  });
}

/**
 * Publish one package, tolerating "already published" (E409 / "cannot
 * publish over previously published versions") so re-runs are idempotent —
 * both the public npm registry and GitHub Packages reject republishing an
 * existing version.
 */
function publishPackage(name, args, cwd) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('npm', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString('utf8');
    });
    child.once('error', rejectPromise);
    child.once('exit', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      if (/cannot publish over|previously published/i.test(output)) {
        console.log(`[skip-publish] ${name} — version already published, nothing to do`);
        resolvePromise();
        return;
      }
      const tail = output.trim().split('\n').slice(-8).join('\n');
      rejectPromise(new Error(`npm publish exited with code ${String(code)}\n${tail}`));
    });
  });
}

async function main() {
  await mkdir(join(ROOT, 'dist'), { recursive: true });
  if (packDir) await mkdir(packDir, { recursive: true });

  for (const name of PACKAGE_NAMES) {
    const dir = await assemblePackage({
      root: ROOT,
      name,
      githubScope: github ? (process.env.GITHUB_PACKAGE_SCOPE ?? 'plutokeaking') : undefined,
    });
    try {
      if (skipPublish) {
        const version = JSON.parse(
          await readFile(join(dir, 'package.json'), 'utf8'),
        ).version;
        console.log(`[skip-publish] ${name}@${version} — version already published, packing artifacts only`);
      } else {
        const publishArgs = github
          ? ['publish', '--registry', 'https://npm.pkg.github.com']
          : ['publish', '--access', 'public'];
        if (dryRun) {
          publishArgs.push('--dry-run');
        } else if (process.env.GITHUB_ACTIONS === 'true' && !github) {
          publishArgs.push('--provenance');
        }
        await publishPackage(name, publishArgs, dir);
      }

      if (packDir) {
        await run('npm', ['pack', '--pack-destination', packDir], dir);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

await main();
