import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  currentVersion,
  isNewer,
  latestVersion,
  resetUpdateCheckCache,
  UPDATE_CHECK_FAILURE_CACHE_MS,
  upgradeCheckEnabled,
} from '../../src/upgrade/update-check.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
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

  it('does not stick a failed lookup for the full success window', async () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const probe = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce('0.14.0');

    // First probe fails and is cached for only the short failure window.
    await expect(latestVersion({ probe })).resolves.toBeUndefined();
    // A call right after the failure is served from that brief cache.
    await expect(latestVersion({ probe })).resolves.toBeUndefined();
    expect(probe).toHaveBeenCalledTimes(1);

    // Once the short failure window elapses, the next call re-probes and succeeds.
    now += UPDATE_CHECK_FAILURE_CACHE_MS + 1;
    await expect(latestVersion({ probe })).resolves.toBe('0.14.0');
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('honors an explicit cacheMs override even right after a failed lookup', async () => {
    const probe = vi.fn().mockResolvedValue(undefined);
    await expect(latestVersion({ probe, cacheMs: 0 })).resolves.toBeUndefined();
    await expect(latestVersion({ probe, cacheMs: 0 })).resolves.toBeUndefined();
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('respects DSH_LARK_UPGRADE_CHECK=0', async () => {
    vi.stubEnv('DSH_LARK_UPGRADE_CHECK', '0');
    expect(upgradeCheckEnabled()).toBe(false);
    const probe = vi.fn().mockResolvedValue('0.14.0');
    await expect(latestVersion({ probe })).resolves.toBeUndefined();
    expect(probe).not.toHaveBeenCalled();
  });
});
