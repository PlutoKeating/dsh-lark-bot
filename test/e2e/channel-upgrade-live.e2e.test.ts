import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ownPackageInfo } from '../../src/adapters/dsh/own-package.js';
import {
  GuardianUpdateHandoff,
  runGuardianUpdateWorker,
} from '../../src/guardian/update-handoff.js';

const runLive = process.env.DSH_LARK_LIVE_CHANNEL_UPGRADE === '1';

describe.runIf(runLive)('live channel upgrade worker', () => {
  it('runs the published current version through the isolated full upgrade path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-live-channel-upgrade-'));
    const file = join(root, 'guardian', 'update.json');
    const version = ownPackageInfo().version;
    if (!version) throw new Error('live upgrade validation requires a package version');
    const handoff = new GuardianUpdateHandoff({
      file,
      packageName: ownPackageInfo().name,
      dshProfile: process.env.DSH_LARK_LIVE_UPGRADE_PROFILE ?? 'dsh-lark',
      launch: vi.fn().mockResolvedValue(undefined),
      id: () => 'live-update-validation',
    });
    try {
      await handoff.start(version, { chatId: 'validation-only', requesterId: 'validation-only' });
      await runGuardianUpdateWorker(
        { stateFile: file, id: 'live-update-validation' },
        { delayMs: 0 },
      );
      const state = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
      expect(state).toMatchObject({
        status: 'succeeded',
        targetVersion: version,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30 * 60_000);
});
