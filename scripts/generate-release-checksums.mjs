#!/usr/bin/env node
/**
 * generate-release-checksums.mjs
 *
 * Generate a `<asset>.sha256` file for every `*.tgz` in a directory
 * (default `release-artifacts`). Used by `.github/workflows/release.yml` to
 * fulfill the SECURITY.md commitment: every published Release asset ships
 * with a SHA-256 checksum file (see docs/DOWNLOAD.md for verification steps).
 *
 * Output format matches `sha256sum` / `shasum -a 256`:
 *   `<hex digest>  <filename>`
 * so users can verify with `sha256sum -c` or `shasum -a 256 -c`.
 *
 * Usage:
 *   node scripts/generate-release-checksums.mjs [dir]
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] ?? 'release-artifacts';
const files = readdirSync(dir).filter((name) => name.endsWith('.tgz'));

if (files.length === 0) {
  console.error(`[checksums] no .tgz files found in ${dir}`);
  process.exit(1);
}

for (const file of files) {
  const fullPath = path.join(dir, file);
  const hash = createHash('sha256').update(readFileSync(fullPath)).digest('hex');
  const checksumFile = `${fullPath}.sha256`;
  writeFileSync(checksumFile, `${hash}  ${file}\n`);
  console.log(`${checksumFile}: ${hash}`);
}
