import { mkdir, mkdtemp, readdir, rm, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { withFileLock } from '../../src/platform/file-lock.js';

const roots: string[] = [];
afterEach(async () => Promise.all(
  roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
));

describe('withFileLock', () => {
  it('reclaims a dead owner and removes only its own lease', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-file-lock-'));
    roots.push(root);
    const path = join(root, 'state.lock');
    await mkdir(path);
    await writeFile(
      join(path, 'dead.json'),
      JSON.stringify({ pid: 2_147_483_647, token: 'dead', createdAt: 0 }),
    );

    const value = await withFileLock(path, 'busy', async () => 'ok');
    expect(value).toBe('ok');
    await expect(readdir(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reclaims an abandoned owner-initialization directory instead of deadlocking forever', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-file-lock-stale-'));
    roots.push(root);
    const path = join(root, 'state.lock');
    await mkdir(path);
    await utimes(path, new Date(0), new Date(0));

    await expect(withFileLock(path, 'busy', async () => 42)).resolves.toBe(42);
  });

  it('keeps concurrent owners out of the same critical section', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-file-lock-concurrent-'));
    roots.push(root);
    const path = join(root, 'state.lock');
    let active = 0;
    let peak = 0;
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const first = withFileLock(path, 'busy', async () => {
      active += 1;
      peak = Math.max(peak, active);
      await firstGate;
      active -= 1;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = withFileLock(path, 'busy', async () => {
      active += 1;
      peak = Math.max(peak, active);
      active -= 1;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(peak).toBe(1);
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(peak).toBe(1);
  });
});
