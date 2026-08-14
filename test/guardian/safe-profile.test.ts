import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ensureSafeProfile,
  probeSafeProfile,
  safeProfileName,
  safeProfileRoot,
  SAFE_CORE_BUNDLES,
} from '../../src/guardian/safe-profile.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('safe profile provisioning', () => {
  it('creates a core-only profile without third-party plugins', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-safe-'));
    tempDirs.push(dir);
    const dshHome = join(dir, 'dsh-home');
    const env = { DSH_HOME: dshHome };

    const result = await ensureSafeProfile({ home: dir, dshProfile: 'dsh-lark', env });
    expect(result.created).toBe(true);
    expect(result.root).toBe(safeProfileRoot(dir, 'dsh-lark', env));
    expect(safeProfileName('dsh-lark')).toBe('dsh-lark-safe');

    const manifest = JSON.parse(await readFile(join(result.root, 'package.json'), 'utf8'));
    expect(manifest.dsh.profile.bundles).toEqual([...SAFE_CORE_BUNDLES]);
    expect(manifest.dsh.profile.bundles).not.toContain('dsh-lark-bot');
    expect(await readFile(join(result.root, 'cordis.patch.yml'), 'utf8')).toBe('[]\n');
    expect(await readFile(join(result.root, 'cordis.yml'), 'utf8')).toContain('[]');
  });

  it('is idempotent and never overwrites existing files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-safe-idem-'));
    tempDirs.push(dir);
    const first = await ensureSafeProfile({ home: dir, dshProfile: 'dsh-lark' });
    const second = await ensureSafeProfile({ home: dir, dshProfile: 'dsh-lark' });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
  });

  it('probes the safe profile with dsh --dump-config', async () => {
    const run = vi.fn().mockResolvedValue({ code: 0, stdout: 'rows', stderr: '' });
    const result = await probeSafeProfile({
      bin: '/fake/bin.js',
      dshProfile: 'dsh-lark',
      home: '/tmp',
      run,
    });
    expect(result.ok).toBe(true);
    expect(run).toHaveBeenCalledWith('/fake/bin.js', [
      '--profile',
      'dsh-lark-safe',
      '--dump-config',
    ]);
  });

  it('surfaces probe failures with the stderr tail', async () => {
    const run = vi.fn().mockResolvedValue({
      code: 1,
      stdout: '',
      stderr: 'boom\ncannot resolve bundle @deepseek-ai/dsh-headless\n',
    });
    const result = await probeSafeProfile({
      bin: '/fake/bin.js',
      dshProfile: 'dsh-lark',
      home: '/tmp',
      run,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('cannot resolve bundle');
  });
});
