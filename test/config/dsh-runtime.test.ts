import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverDshBin, resolveDshRuntime } from '../../src/config/dsh-runtime.js';

describe('dsh runtime discovery', () => {
  it('finds dsh installed under DSH_HOME/profiles/node_modules', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-runtime-'));
    const bin = join(root, 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
    await mkdir(join(bin, '..'), { recursive: true });
    await writeFile(bin, '#!/usr/bin/env node\n');

    try {
      expect(discoverDshBin(join(root, 'bridge-home'), { DSH_HOME: root })).toBe(bin);
      expect(resolveDshRuntime({ home: join(root, 'bridge-home'), env: { DSH_HOME: root } })).toEqual({
        command: 'node',
        args: [bin, '--profile', 'headless'],
        bin,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('falls back to the global dsh command when no local installation is found', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-runtime-empty-'));
    try {
      expect(resolveDshRuntime({ home: root, env: { DSH_HOME: join(root, '.dsh') } })).toEqual({
        command: 'dsh',
        args: ['--profile', 'headless'],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reuses the canonical dsh CLI for an isolated instance DSH_HOME', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-runtime-isolated-'));
    const bin = join(root, '.dsh', 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
    await mkdir(join(bin, '..'), { recursive: true });
    await writeFile(bin, '#!/usr/bin/env node\n');
    try {
      expect(discoverDshBin(root, { DSH_HOME: join(root, 'fleet', 'reviewer', 'dsh') })).toBe(bin);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps explicit command and args unchanged', () => {
    expect(
      resolveDshRuntime({
        command: 'node',
        args: ['custom-bin.js', 'custom.yml'],
        home: '/tmp/ignored',
      }),
    ).toEqual({
      command: 'node',
      args: ['custom-bin.js', 'custom.yml'],
    });
  });
});
