import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadGuardianState,
  newGuardianState,
  saveGuardianState,
} from '../../src/guardian/state.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('guardian state', () => {
  it('round-trips state through the state file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-guardian-state-'));
    tempDirs.push(dir);
    const file = join(dir, 'guardian.json');
    const state = newGuardianState({ dshProfile: 'dsh-lark', bridgeProfile: 'default' });
    state.profileSeenUp = true;
    state.mode = 'safe';
    state.relaunchedPid = 99;
    await saveGuardianState(file, state);

    const loaded = await loadGuardianState(file, newGuardianState({}));
    expect(loaded.dshProfile).toBe('dsh-lark');
    expect(loaded.bridgeProfile).toBe('default');
    expect(loaded.safeProfile).toBe('dsh-lark-safe');
    expect(loaded.profileSeenUp).toBe(true);
    expect(loaded.mode).toBe('safe');
    expect(loaded.relaunchedPid).toBe(99);
  });

  it('falls back to defaults for a missing or corrupt file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-guardian-state-missing-'));
    tempDirs.push(dir);
    const fallback = newGuardianState({ dshProfile: 'dsh-lark', bridgeProfile: 'default' });
    const missing = await loadGuardianState(join(dir, 'missing.json'), fallback);
    expect(missing.dshProfile).toBe('dsh-lark');
    expect(missing.profileSeenUp).toBe(false);
    expect(missing.mode).toBe('standby');

    const corruptFile = join(dir, 'corrupt.json');
    await saveGuardianState(corruptFile, fallback);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(corruptFile, 'not json', 'utf8');
    const corrupt = await loadGuardianState(corruptFile, fallback);
    expect(corrupt.dshProfile).toBe('dsh-lark');
  });
});
