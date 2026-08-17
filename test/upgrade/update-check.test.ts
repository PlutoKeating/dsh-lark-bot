import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isNewer,
  latestVersion,
  resetUpdateCheckCache,
  upgradeCheckEnabled,
} from '../../src/upgrade/update-check.js';

afterEach(() => {
  vi.unstubAllEnvs();
  resetUpdateCheckCache();
});

describe('update-check', () => {
  it('isNewer compares versions', () => {
    expect(isNewer('0.14.0', '0.13.1')).toBe(true);
    expect(isNewer('0.13.1', '0.13.1')).toBe(false);
    expect(isNewer(undefined, '0.13.1')).toBe(false);
  });

  it('caches the latest version within the window', async () => {
    const probe = vi.fn().mockResolvedValue('0.14.0');
    await expect(latestVersion({ probe, cacheMs: 60_000 })).resolves.toBe('0.14.0');
    await expect(latestVersion({ probe, cacheMs: 60_000 })).resolves.toBe('0.14.0');
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('respects DSH_LARK_UPGRADE_CHECK=0', async () => {
    vi.stubEnv('DSH_LARK_UPGRADE_CHECK', '0');
    expect(upgradeCheckEnabled()).toBe(false);
    const probe = vi.fn().mockResolvedValue('0.14.0');
    await expect(latestVersion({ probe })).resolves.toBeUndefined();
    expect(probe).not.toHaveBeenCalled();
  });
});
