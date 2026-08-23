import { describe, expect, it, vi } from 'vitest';
import {
  buildIssueBody,
  compareVersions,
  collectReleaseEvents,
  extractReleaseMarker,
  fetchUpstreamData,
  indexReleaseIssues,
  normalizeVersion,
  replaceManagedSection,
  sanitizeExternalMarkdown,
} from '../scripts/check-dsh-upstream.mjs';

const upstream = {
  id: 'dsh',
  name: 'DeepSeek Harness (dsh)',
  repository: 'deepseek-ai/deepseek-harness',
  trackFrom: '0.1.0-rc.8',
  npmPackages: ['@deepseek-ai/dsh', '@deepseek-ai/dsh-sdk-client'],
};

describe('upstream release watcher', () => {
  it('normalizes configured GitHub tag prefixes and prereleases', () => {
    expect(normalizeVersion('dsh-v0.1.1-rc.2')).toBe('0.1.1-rc.2');
    expect(normalizeVersion('v0.9.0')).toBe('0.9.0');
    expect(normalizeVersion('release-nine')).toBeUndefined();
    expect(compareVersions('0.1.1-rc.10', '0.1.1-rc.9')).toBeGreaterThan(0);
    expect(compareVersions('0.1.1', '0.1.1-rc.10')).toBeGreaterThan(0);
  });

  it('merges GitHub and npm metadata and discovers every version above baseline', () => {
    const events = collectReleaseEvents(upstream, {
      githubReleases: [
        { tag_name: 'dsh-v0.1.1-rc.2', name: 'rc.2', body: 'notes', draft: false,
          prerelease: true, published_at: '2026-08-21T12:35:08Z', html_url: 'https://gh/r2',
          target_commitish: 'main' },
        { tag_name: 'dsh-v0.1.1-rc.1', name: 'rc.1', body: 'one', draft: false,
          prerelease: true, published_at: '2026-08-21T07:12:39Z', html_url: 'https://gh/r1',
          target_commitish: 'main' },
      ],
      npmDocuments: {
        '@deepseek-ai/dsh': {
          versions: { '0.1.1-rc.1': {}, '0.1.1-rc.2': {} },
          time: { '0.1.1-rc.1': '2026-08-21T07:10:00Z', '0.1.1-rc.2': '2026-08-21T12:30:00Z' },
          'dist-tags': { latest: '0.1.1-rc.2', next: '0.1.1-rc.2' },
        },
        '@deepseek-ai/dsh-sdk-client': {
          versions: { '0.1.1-rc.2': {} }, time: { '0.1.1-rc.2': '2026-08-21T12:31:00Z' },
          'dist-tags': { latest: '0.0.1-rc.1', next: '0.1.1-rc.2' },
        },
      },
      sourceErrors: [],
    });

    expect(events.map((event) => event.version)).toEqual(['0.1.1-rc.1', '0.1.1-rc.2']);
    expect(events[1]?.githubRelease?.tag_name).toBe('dsh-v0.1.1-rc.2');
    expect(events[1]?.npmPackages).toHaveLength(2);
  });

  it('does not emit the baseline or historical versions', () => {
    const events = collectReleaseEvents(upstream, {
      githubReleases: [{ tag_name: 'dsh-v0.1.0-rc.8', draft: false }],
      npmDocuments: {
        '@deepseek-ai/dsh': { versions: { '0.1.0-rc.7': {}, '0.1.0-rc.8': {} } },
      },
      sourceErrors: [],
    });
    expect(events).toEqual([]);
  });

  it('builds an npm-only issue with a stable marker and explicit missing-release note', () => {
    const [event] = collectReleaseEvents(upstream, {
      githubReleases: [],
      npmDocuments: {
        '@deepseek-ai/dsh': {
          versions: { '0.1.1-rc.1': {} }, time: { '0.1.1-rc.1': '2026-08-21T07:10:00Z' },
          'dist-tags': { next: '0.1.1-rc.1' },
        },
      },
      sourceErrors: [],
    });
    const body = buildIssueBody(upstream, event!);
    expect(body).toContain('<!-- upstream-release-watch:v1 upstream=dsh version=0.1.1-rc.1 -->');
    expect(body).toContain('尚无对应的 GitHub Release');
    expect(body).toContain('未分析本项目兼容性');
  });

  it('deduplicates by markers across open and closed issues instead of titles', () => {
    expect(extractReleaseMarker('renamed\n<!-- upstream-release-watch:v1 upstream=dsh version=1.2.3 -->'))
      .toEqual({ upstream: 'dsh', version: '1.2.3' });
    const indexed = indexReleaseIssues([
      { number: 10, state: 'closed', title: 'renamed', body: '<!-- upstream-release-watch:v1 upstream=dsh version=1.2.3 -->' },
      { number: 11, state: 'open', title: 'same-looking title', body: 'no marker' },
    ]);
    expect(indexed.get('dsh\0' + '1.2.3')).toMatchObject({ number: 10, state: 'closed' });
    expect(indexed).toHaveLength(1);
  });

  it('updates only the generated section when GitHub notes arrive later', () => {
    const original = '<!-- upstream-release-watch:managed-start -->old<!-- upstream-release-watch:managed-end -->\n- [x] human decision';
    const updated = replaceManagedSection(original, 'new release details');
    expect(updated).toContain('new release details');
    expect(updated).toContain('- [x] human decision');
    expect(updated).not.toContain('>old<');
  });

  it('neutralizes mentions, strips control characters and truncates external notes', () => {
    const safe = sanitizeExternalMarkdown(`hello @everyone\u0000 <!-- upstream-release-watch:managed-end --> ${'x'.repeat(200)}`, 80);
    expect(safe).toContain('@\u200beveryone');
    expect(safe).not.toContain('\u0000');
    expect(safe).not.toContain('<!-- upstream-release-watch');
    expect(safe).toContain('已截断');
  });

  it('degrades to npm when GitHub fails, but fails when every source fails', async () => {
    const npmDocument = { versions: { '0.1.1-rc.1': {} }, 'dist-tags': {} };
    const fetchWithNpm = vi.fn(async (url: string) => {
      if (url.includes('api.github.com')) return new Response('bad gateway', { status: 502 });
      return new Response(JSON.stringify(npmDocument), { status: 200 });
    });
    const partial = await fetchUpstreamData(upstream, fetchWithNpm as typeof fetch);
    expect(partial.githubReleases).toEqual([]);
    expect(partial.npmDocuments['@deepseek-ai/dsh']).toEqual(npmDocument);
    expect(partial.sourceErrors.some((entry) => entry.startsWith('GitHub:'))).toBe(true);

    const allFail = vi.fn(async () => new Response('unavailable', { status: 503 }));
    await expect(fetchUpstreamData(upstream, allFail as typeof fetch)).rejects.toThrow(
      'all release sources failed',
    );
  });
});
