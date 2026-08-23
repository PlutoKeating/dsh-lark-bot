import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  currentVersion,
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

  it('isNewer never claims an update when the running version is unknown', () => {
    // An empty current is the "unknown" sentinel; it must not be compared as a
    // real version (the `/new` ~0.9.0 false-positive regression).
    expect(isNewer('0.19.3', '')).toBe(false);
    expect(isNewer(undefined, '')).toBe(false);
  });

  it('currentVersion returns a resolvable semver when the package is known', () => {
    // In the test process this resolves the repo's own package.json via the
    // upward walk (no co-located manifest at `../package.json` from src/).
    const version = currentVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
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
