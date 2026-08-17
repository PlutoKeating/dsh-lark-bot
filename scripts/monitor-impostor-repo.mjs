#!/usr/bin/env node
/**
 * monitor-impostor-repo.mjs
 *
 * 假冒仓库与仿冒包持续监控（官方渠道护城河，issue #38）。
 *
 * 监控对象：
 * - 假冒仓库 tarraencompassing61/dsh-lark-bot：pushed_at / stars / releases / README 哈希；
 * - npm 仿冒包 dsh-f：版本与发布时间；
 * - npm 官方包版本漂移 + 相似包名抢注清单。
 *
 * 状态文件默认 ~/.dsh-lark/security-monitor-state.json：首次运行建立基线，之后报告差异。
 *
 * 用法：
 *   node scripts/monitor-impostor-repo.mjs            # 人类可读报告
 *   node scripts/monitor-impostor-repo.mjs --json     # 输出完整快照 JSON
 *   node scripts/monitor-impostor-repo.mjs --state <file>
 *
 * 退出码：0 = 无变化；2 = 检测到变化（新 Release / 仿冒包发版 / 相似包名被抢注）；1 = 获取数据出错。
 * 建议每周运行一次（cron：npm run security:monitor）。
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const DEFAULT_STATE = path.join(homedir(), '.dsh-lark', 'security-monitor-state.json');
const IMPOSTOR_REPO = 'tarraencompassing61/dsh-lark-bot';
const NPM_DERIVATIVE = 'dsh-f';
const NPM_OFFICIAL = ['dsh-lark-bot', 'dsh-feishu-bot'];
// 相似包名抢注监控清单（当前均已确认未注册；一旦被注册即告警）
const NPM_TYPOS = [
  'dsh-larkbot',
  'dsh-lark-bot2',
  'dsh-lark-bot-cli',
  'dsh-lark-bot-latest',
  'dsh-lark-bot-core',
  'dsh-lark-bot-beta',
  'dsh-lark-bot-ts',
  'dsh-lark-bot-node',
  'dsh-feishubot',
  'dsh-feishu-bot-latest',
];

const args = new Set(process.argv.slice(2));
const jsonOutput = args.has('--json');
const stateIndex = process.argv.indexOf('--state');
const statePath = stateIndex !== -1 && process.argv[stateIndex + 1] ? process.argv[stateIndex + 1] : DEFAULT_STATE;

async function getJson(url, timeoutMs = 15000) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'dsh-lark-bot-security-monitor' },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} ${url}`);
  return res.json();
}

async function headStatus(url, timeoutMs = 15000) {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(timeoutMs) });
    return res.status;
  } catch {
    return 0;
  }
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function diff(prev, cur, base = '') {
  const changes = [];
  for (const [key, value] of Object.entries(cur)) {
    const prefix = base ? `${base}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      changes.push(...diff(prev?.[key] ?? {}, value, prefix));
    } else if (Array.isArray(value)) {
      const prevJson = JSON.stringify(prev?.[key] ?? []);
      const curJson = JSON.stringify(value);
      if (prevJson !== curJson) changes.push(`${prefix}: ${prevJson} -> ${curJson}`);
    } else if (prev?.[key] !== value) {
      changes.push(`${prefix}: ${prev?.[key] ?? '<none>'} -> ${value}`);
    }
  }
  return changes;
}

async function snapshot() {
  const [repo, releases, latestCommit, readme, npmDerivative, npmOfficial, typoStatus] = await Promise.all([
    getJson(`https://api.github.com/repos/${IMPOSTOR_REPO}`),
    getJson(`https://api.github.com/repos/${IMPOSTOR_REPO}/releases`),
    getJson(`https://api.github.com/repos/${IMPOSTOR_REPO}/commits?per_page=1`).then((list) => list[0] ?? null),
    fetch(`https://raw.githubusercontent.com/${IMPOSTOR_REPO}/main/README.md`, {
      signal: AbortSignal.timeout(15000),
    }).then((res) => (res.ok ? res.text() : '')),
    getJson(`https://registry.npmjs.org/${NPM_DERIVATIVE}`).then((pkg) => ({
      name: pkg.name,
      version: pkg['dist-tags']?.latest ?? null,
      modified: pkg.time?.modified ?? null,
      maintainers: (pkg.maintainers ?? []).map((maintainer) => maintainer.name),
    })),
    Promise.all(NPM_OFFICIAL.map((name) =>
      getJson(`https://registry.npmjs.org/${name}`).then((pkg) => ({
        name,
        version: pkg['dist-tags']?.latest ?? null,
        modified: pkg.time?.modified ?? null,
      })),
    )),
    Promise.all(NPM_TYPOS.map(async (name) => ({
      name,
      status: await headStatus(`https://registry.npmjs.org/${name}`),
    }))),
  ]);

  return {
    capturedAt: new Date().toISOString(),
    impostorRepo: {
      fullName: repo.full_name,
      fork: repo.fork,
      createdAt: repo.created_at,
      pushedAt: repo.pushed_at,
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      openIssues: repo.open_issues_count,
      hasIssues: repo.has_issues,
      archived: repo.archived,
      disabled: repo.disabled,
      defaultBranch: repo.default_branch,
      description: repo.description,
      topics: repo.topics,
    },
    impostorReleases: releases.map((release) => ({
      tag: release.tag_name,
      publishedAt: release.published_at,
      assets: (release.assets ?? []).map((asset) => asset.name),
    })),
    impostorLatestCommit: latestCommit
      ? {
          sha: latestCommit.sha,
          date: latestCommit.commit?.author?.date ?? null,
          author: latestCommit.commit?.author?.name ?? null,
          message: latestCommit.commit?.message?.split('\n')[0] ?? null,
        }
      : null,
    impostorReadmeSha256: sha256(readme),
    npmDerivative,
    npmOfficial,
    npmTypoStatus: Object.fromEntries(typoStatus.map((entry) => [
      entry.name,
      entry.status === 404 ? 'available' : entry.status === 200 ? 'TAKEN' : `unknown(${entry.status})`,
    ])),
  };
}

async function main() {
  let prev = null;
  try {
    prev = JSON.parse(await readFile(statePath, 'utf8'));
  } catch {
    // 首次运行：建立基线
  }

  let snap;
  try {
    snap = await snapshot();
  } catch (err) {
    console.error(`[monitor] 获取数据失败: ${err.message}`);
    process.exit(1);
  }

  const changes = prev ? diff(prev, snap) : [];
  const releaseWarnings = snap.impostorReleases.length > 0
    ? snap.impostorReleases.map((release) =>
        `⚠️ 假冒仓库出现 Release: ${release.tag}（${release.publishedAt}）assets=${release.assets.join(',') || '无'} —— 立即固证并按“分发恶意软件”举报！`)
    : [];
  const typoWarnings = Object.entries(snap.npmTypoStatus)
    .filter(([, status]) => status === 'TAKEN')
    .map(([name]) => `⚠️ 相似包名已被注册: ${name}`);

  if (jsonOutput) {
    console.log(JSON.stringify({ snapshot: snap, changes, releaseWarnings, typoWarnings }, null, 2));
  } else {
    console.log(`[monitor] 假冒仓库监控 · ${snap.capturedAt}`);
    console.log(
      `假冒仓库 ${snap.impostorRepo.fullName}: fork=${snap.impostorRepo.fork} ` +
      `pushed=${snap.impostorRepo.pushedAt} stars=${snap.impostorRepo.stars} ` +
      `issues=${snap.impostorRepo.openIssues} hasIssues=${snap.impostorRepo.hasIssues}`,
    );
    console.log(
      `假冒仓库 Releases: ${snap.impostorReleases.length} | ` +
      `最新 commit: ${snap.impostorLatestCommit?.sha?.slice(0, 7) ?? '-'} ${snap.impostorLatestCommit?.message ?? ''}`,
    );
    console.log(
      `npm 仿冒包 ${snap.npmDerivative.name}: v${snap.npmDerivative.version} ` +
      `modified=${snap.npmDerivative.modified}`,
    );
    console.log(`npm 官方包: ${snap.npmOfficial.map((pkg) => `${pkg.name}@${pkg.version}`).join(' / ')}`);
    const taken = Object.entries(snap.npmTypoStatus).filter(([, status]) => status === 'TAKEN');
    console.log(
      `相似包名: ${Object.values(snap.npmTypoStatus).filter((s) => s === 'available').length} 未注册, ` +
      `${taken.length} 已被注册`,
    );
    for (const warning of [...releaseWarnings, ...typoWarnings]) console.log(warning);
    if (changes.length > 0) {
      console.log('--- 相对上次变化 ---');
      for (const change of changes) console.log('CHANGED', change);
    } else if (prev) {
      console.log('--- 无变化 ---');
    } else {
      console.log('--- 首次运行，基线已建立 ---');
    }
  }

  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(snap, null, 2), { mode: 0o600 });

  process.exit(changes.length > 0 || releaseWarnings.length > 0 || typoWarnings.length > 0 ? 2 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
