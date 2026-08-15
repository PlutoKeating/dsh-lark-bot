#!/usr/bin/env node

// Generates GitHub Release notes from conventional commits between two git
// refs. The release workflow uses this instead of GitHub's auto-generated
// notes, which are near-empty for direct-push tags (no PRs to summarize).
//
// Usage:
//   node scripts/release-notes.mjs --from <ref> [--to <ref>]
// Prints the markdown body to stdout.

import { spawnSync } from 'node:child_process';

const GROUPS = [
  { prefix: 'feat', label: '✨ Features / 新功能' },
  { prefix: 'fix', label: '🐛 Fixes / 修复' },
  { prefix: 'docs', label: '📚 Documentation / 文档' },
  { prefix: 'test', label: '🧪 Tests / 测试' },
  { prefix: 'ci', label: '⚙️ CI & Release / 流水线' },
  { prefix: 'release', label: '🚀 Release / 发布' },
];

function gitLog(from, to) {
  const range = from ? `${from}..${to}` : to;
  const result = spawnSync('git', ['log', '--format=%s', '--no-merges', range], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(
      `git log failed (${String(result.status)}): ${result.stderr.trim()}`,
    );
  }
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function group(commit) {
  const match = /^([a-z]+)(\([^)]*\))?:/.exec(commit);
  if (!match) return undefined;
  const prefix = match[1];
  const group = GROUPS.find((entry) => entry.prefix === prefix);
  if (!group) return undefined;
  const subject = commit.slice(match[0].length).trim();
  return { group, subject };
}

/**
 * Build the release body for `from..to`. Exported for tests; the CLI wrapper
 * below prints it.
 */
export function buildReleaseNotes(commits, from, to) {
  const lines = [];
  lines.push(`## What's Changed`);
  lines.push('');
  for (const { prefix, label } of GROUPS) {
    const items = commits
      .map(group)
      .filter((entry) => entry?.group.prefix === prefix)
      .map((entry) => `- ${entry.subject}`);
    if (items.length === 0) continue;
    lines.push(`### ${label}`);
    lines.push(...items);
    lines.push('');
  }
  const ungrouped = commits
    .map((commit) => ({ commit, entry: group(commit) }))
    .filter(({ entry }) => entry === undefined)
    .map(({ commit }) => `- ${commit}`);
  if (ungrouped.length > 0) {
    lines.push(`### Other`);
    lines.push(...ungrouped);
    lines.push('');
  }
  if (from && to) {
    lines.push(
      `**Full Changelog**: https://github.com/PlutoKeating/dsh-lark-bot/compare/${from}...${to}`,
    );
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function parseArgs(argv) {
  const args = { from: undefined, to: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--from') args.from = argv[i + 1];
    if (argv[i] === '--to') args.to = argv[i + 1];
  }
  return args;
}

if (process.argv[1]?.endsWith('release-notes.mjs')) {
  const { from, to } = parseArgs(process.argv.slice(2));
  const target = to ?? 'HEAD';
  process.stdout.write(buildReleaseNotes(gitLog(from, target), from, target));
}
