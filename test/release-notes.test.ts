import { describe, expect, it } from 'vitest';
import { buildReleaseNotes } from '../scripts/release-notes.mjs';

describe('buildReleaseNotes', () => {
  it('groups conventional commits by type and links the changelog', () => {
    const commits = [
      'fix(guardian): make the run watchdog an idle timeout',
      'feat(cards): show elapsed state on run cards',
      'docs: align every doc with the current implementation',
      'release: v0.10.1',
      'an ungrouped commit',
    ];
    const body = buildReleaseNotes(commits, 'v0.10.0', 'v0.10.1');
    expect(body).toContain('### ✨ Features / 新功能');
    expect(body).toContain('- show elapsed state on run cards');
    expect(body).toContain('### 🐛 Fixes / 修复');
    expect(body).toContain('- make the run watchdog an idle timeout');
    expect(body).toContain('### 📚 Documentation / 文档');
    expect(body).toContain('### 🚀 Release / 发布');
    expect(body).toContain('- v0.10.1');
    expect(body).toContain('### Other');
    expect(body).toContain('- an ungrouped commit');
    expect(body).toContain(
      'https://github.com/PlutoKeating/dsh-lark-bot/compare/v0.10.0...v0.10.1',
    );
  });

  it('omits empty groups', () => {
    const body = buildReleaseNotes(['fix: something'], 'v0.9.0', 'v0.9.1');
    expect(body).not.toContain('### ✨ Features / 新功能');
    expect(body).toContain('### 🐛 Fixes / 修复');
  });
});
