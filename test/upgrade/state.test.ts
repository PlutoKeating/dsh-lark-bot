import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadUpgradeState,
  saveUpgradeState,
  upgradeStatePath,
  type UpgradeRecord,
} from '../../src/upgrade/state.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const sample: UpgradeRecord = {
  at: '2026-08-15T23:00:00.000Z',
  fromVersion: '0.10.2',
  toVersion: '0.11.0',
  profile: 'dsh-lark',
  packageSpec: 'dsh-lark-bot@0.11.0',
  guardianInstalled: true,
};

describe('upgrade state', () => {
  it('round-trips a recorded upgrade', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-upgrade-state-'));
    tempDirs.push(dir);
    const file = upgradeStatePath(dir);

    await saveUpgradeState(file, { schemaVersion: 1, lastUpgrade: sample });
    const loaded = await loadUpgradeState(file);
    expect(loaded).toEqual({ schemaVersion: 1, lastUpgrade: sample });
  });

  it('returns undefined when the file is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-upgrade-missing-'));
    tempDirs.push(dir);
    await expect(loadUpgradeState(upgradeStatePath(dir))).resolves.toBeUndefined();
  });

  it('rejects malformed state files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-upgrade-bad-'));
    tempDirs.push(dir);
    const file = join(dir, 'upgrade-state.json');
    await import('node:fs/promises').then((fs) =>
      fs.writeFile(file, '{"schemaVersion": 1}\n', 'utf8'),
    );
    await expect(loadUpgradeState(file)).resolves.toBeUndefined();
  });

  it('writes JSON that keeps credentials out of the file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-upgrade-safe-'));
    tempDirs.push(dir);
    const file = upgradeStatePath(dir);
    await saveUpgradeState(file, { schemaVersion: 1, lastUpgrade: sample });
    const raw = await readFile(file, 'utf8');
    expect(raw).not.toContain('secret');
    expect(raw).not.toContain('appId');
  });
});
