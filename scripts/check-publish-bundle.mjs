#!/usr/bin/env node

// Standalone release gate: verifies the freshly built `dist/` satisfies every
// subpath export in package.json plus the CLI entry consumed by bin/*.mjs.
// Wired into `ci:local`, `release:check` and the release workflow after
// `pnpm build`, so a missing artifact aborts the pipeline before publish.

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { validateDistCompleteness } from './publish-bundle.mjs';

const ROOT = resolve(new URL('..', import.meta.url).pathname);

const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
const resolved = validateDistCompleteness(join(ROOT, 'dist'), pkg, { label: 'dist' });
console.log(`publish bundle OK: ${resolved.length} export/bin artifact(s) present in dist`);
