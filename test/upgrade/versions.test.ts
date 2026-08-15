import { describe, expect, it, vi } from 'vitest';
import {
  compareVersions,
  fetchNpmLatestVersion,
  isVersionUpgrade,
  packageSpecFor,
  parseVersion,
} from '../../src/upgrade/versions.js';

describe('parseVersion', () => {
  it('parses plain x.y.z versions', () => {
    expect(parseVersion('0.11.0')).toEqual({ major: 0, minor: 11, patch: 0 });
  });

  it('tolerates a leading v', () => {
    expect(parseVersion('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it('parses prerelease tags', () => {
    expect(parseVersion('1.2.3-rc.1')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: 'rc.1',
    });
  });

  it('returns undefined for unparsable input', () => {
    expect(parseVersion('latest')).toBeUndefined();
    expect(parseVersion('1.2')).toBeUndefined();
    expect(parseVersion('')).toBeUndefined();
  });
});

describe('compareVersions', () => {
  it('orders numeric segments', () => {
    expect(compareVersions('0.10.2', '0.11.0')).toBe(-1);
    expect(compareVersions('0.11.0', '0.10.2')).toBe(1);
    expect(compareVersions('0.11.0', '0.11.0')).toBe(0);
  });

  it('treats prerelease as older than the release', () => {
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBe(-1);
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBe(1);
  });

  it('orders prereleases lexically when both carry tags', () => {
    expect(compareVersions('1.0.0-rc.1', '1.0.0-rc.2')).toBe(-1);
  });

  it('falls back to lexical comparison for garbage input', () => {
    expect(compareVersions('latest', 'latest')).toBe(0);
    expect(compareVersions('abc', 'xyz')).toBe(-1);
  });
});

describe('isVersionUpgrade', () => {
  it('detects strictly newer versions', () => {
    expect(isVersionUpgrade('0.10.2', '0.11.0')).toBe(true);
    expect(isVersionUpgrade('0.11.0', '0.11.0')).toBe(false);
    expect(isVersionUpgrade('0.11.0', '0.10.2')).toBe(false);
  });
});

describe('packageSpecFor', () => {
  it('builds name@version specs', () => {
    expect(packageSpecFor('dsh-lark-bot', '0.11.0')).toBe('dsh-lark-bot@0.11.0');
  });
});

describe('fetchNpmLatestVersion', () => {
  it('resolves the version from the registry dist-tag endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '0.12.0' }),
    }) as unknown as typeof fetch;
    await expect(fetchNpmLatestVersion('dsh-lark-bot', 'https://reg.test', fetcher)).resolves.toBe(
      '0.12.0',
    );
    expect(fetcher).toHaveBeenCalledWith(
      'https://reg.test/dsh-lark-bot/latest',
      expect.objectContaining({
        headers: { accept: 'application/vnd.npm.install-v1+json' },
      }),
    );
  });

  it('returns undefined on HTTP errors', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;
    await expect(fetchNpmLatestVersion('dsh-lark-bot', 'https://reg.test', fetcher)).resolves.toBeUndefined();
  });

  it('returns undefined when the fetch throws (offline)', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    await expect(fetchNpmLatestVersion('dsh-lark-bot', 'https://reg.test', fetcher)).resolves.toBeUndefined();
  });
});
