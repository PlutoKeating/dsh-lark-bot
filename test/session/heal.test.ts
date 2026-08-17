import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { archiveSessionDir, classifySessionError } from '../../src/session/heal.js';

const tempDirs: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('classifySessionError', () => {
  it('classifies the canonical id-collision resume error as broken', () => {
    expect(
      classifySessionError(
        'session "session-1" already has a persisted log on disk that does not match this live session (id collision)',
      ),
    ).toBe('broken');
    expect(
      classifySessionError(
        "session 'session-1' already has a persisted log that does not match this live session",
      ),
    ).toBe('broken');
  });

  it('classifies corrupt-log errors as corrupt', () => {
    expect(classifySessionError('corrupt session log: cannot parse header')).toBe('corrupt');
    expect(classifySessionError('session log has a seq gap at 3..5')).toBe('corrupt');
  });

  it('does not trigger on unrelated text containing similar words', () => {
    expect(
      classifySessionError('the plan has an id collision with the other ticket'),
    ).toBeUndefined();
    expect(
      classifySessionError('my notes mention a "seq gap" in the roadmap'),
    ).toBeUndefined();
    expect(classifySessionError('does not match this live session')).toBeUndefined();
    expect(classifySessionError('')).toBeUndefined();
  });
});

describe('archiveSessionDir', () => {
  it('copies the session directory to the archive and removes the original', async () => {
    const base = await mkdtemp(join(tmpdir(), 'dsh-heal-'));
    tempDirs.push(base);
    vi.stubEnv('DSH_HOME', join(base, 'dsh'));
    vi.stubEnv('DSH_LARK_HOME', join(base, 'lark'));

    const sessionDir = join(base, 'dsh', 'sessions', 'session-1');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, 'log.jsonl'), '{"seq":1}\n');

    const result = await archiveSessionDir('session-1');
    expect(result.found).toBe(true);
    expect(result.archivePath).toBeDefined();
    expect(await readFile(join(result.archivePath!, 'log.jsonl'), 'utf8')).toBe('{"seq":1}\n');
    expect(await readdir(join(base, 'dsh', 'sessions'))).toHaveLength(0);
  });

  it('reports not found for an unknown session', async () => {
    const base = await mkdtemp(join(tmpdir(), 'dsh-heal-'));
    tempDirs.push(base);
    vi.stubEnv('DSH_HOME', join(base, 'dsh'));
    vi.stubEnv('DSH_LARK_HOME', join(base, 'lark'));
    await mkdir(join(base, 'dsh', 'sessions'), { recursive: true });

    const result = await archiveSessionDir('session-nope');
    expect(result.found).toBe(false);
    expect(result.archivePath).toBeUndefined();
  });
});
