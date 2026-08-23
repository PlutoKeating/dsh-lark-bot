#!/usr/bin/env node
// Dual-source upstream release watcher. External release text is treated only
// as inert data: fetched as JSON, sanitized, bounded, and sent through GitHub's
// JSON API. It is never interpolated into a shell command.
import { pathToFileURL } from 'node:url';
import { readDshCompatibility } from './dsh-compat.mjs';
import { UPSTREAMS } from './upstream-release-config.mjs';

const LABEL = 'upstream-update';
const MANAGED_START = '<!-- upstream-release-watch:managed-start -->';
const MANAGED_END = '<!-- upstream-release-watch:managed-end -->';
const NOTES_LIMIT = 45_000;

export function normalizeVersion(input) {
  if (typeof input !== 'string') return undefined;
  const match = input.trim().match(
    /(?:^|[-/])v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/,
  );
  return match?.[1];
}

function parseVersion(version) {
  const normalized = normalizeVersion(version);
  if (!normalized) return undefined;
  const [withoutBuild] = normalized.split('+');
  const separator = withoutBuild.indexOf('-');
  const core = separator < 0 ? withoutBuild : withoutBuild.slice(0, separator);
  const prerelease = separator < 0 ? undefined : withoutBuild.slice(separator + 1);
  return {
    core: core.split('.').map((part) => Number.parseInt(part, 10)),
    prerelease: prerelease?.split('.'),
  };
}

/** SemVer precedence, including numeric/alphanumeric prerelease identifiers. */
export function compareVersions(a, b) {
  const parsedA = parseVersion(a);
  const parsedB = parseVersion(b);
  if (!parsedA || !parsedB) throw new Error(`invalid semantic version comparison: ${a}, ${b}`);
  for (let index = 0; index < 3; index += 1) {
    const difference = (parsedA.core[index] ?? 0) - (parsedB.core[index] ?? 0);
    if (difference !== 0) return difference;
  }
  if (!parsedA.prerelease && !parsedB.prerelease) return 0;
  if (!parsedA.prerelease) return 1;
  if (!parsedB.prerelease) return -1;
  const length = Math.max(parsedA.prerelease.length, parsedB.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const left = parsedA.prerelease[index];
    const right = parsedB.prerelease[index];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left === right) continue;
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) return Number(left) - Number(right);
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return left.localeCompare(right);
  }
  return 0;
}

export function collectReleaseEvents(upstream, data) {
  const events = new Map();
  for (const release of data.githubReleases) {
    if (release?.draft === true) continue;
    const version = normalizeVersion(release?.tag_name);
    if (!version || compareVersions(version, upstream.trackFrom) <= 0) continue;
    const event = events.get(version) ?? { version, npmPackages: [], sourceErrors: data.sourceErrors };
    event.githubRelease = release;
    events.set(version, event);
  }
  for (const packageName of upstream.npmPackages) {
    const document = data.npmDocuments[packageName];
    if (!document || typeof document !== 'object') continue;
    const versions = document.versions && typeof document.versions === 'object'
      ? Object.keys(document.versions)
      : [];
    for (const rawVersion of versions) {
      const version = normalizeVersion(rawVersion);
      if (!version || compareVersions(version, upstream.trackFrom) <= 0) continue;
      const event = events.get(version) ?? { version, npmPackages: [], sourceErrors: data.sourceErrors };
      const time = document.time && typeof document.time === 'object'
        ? document.time[rawVersion]
        : undefined;
      const distTags = document['dist-tags'] && typeof document['dist-tags'] === 'object'
        ? Object.fromEntries(Object.entries(document['dist-tags']).filter(([, value]) => typeof value === 'string'))
        : {};
      event.npmPackages.push({
        name: packageName,
        ...(typeof time === 'string' ? { publishedAt: time } : {}),
        distTags,
      });
      events.set(version, event);
    }
  }
  return [...events.values()].sort((left, right) => compareVersions(left.version, right.version));
}

export function sanitizeExternalMarkdown(input, limit = NOTES_LIMIT) {
  const clean = String(input ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replaceAll('<!--', '&lt;!--')
    .replace(/@(?=[A-Za-z0-9_-])/g, '@\u200b');
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit)}\n\n> 上游 Release notes 已截断；请通过上方 Release 链接阅读原文。`;
}

function releaseMarker(upstream, version) {
  return `<!-- upstream-release-watch:v1 upstream=${upstream} version=${version} -->`;
}

export function extractReleaseMarker(body) {
  const match = String(body ?? '').match(
    /<!-- upstream-release-watch:v1 upstream=([^\s]+) version=([^\s]+) -->/,
  );
  return match ? { upstream: match[1], version: match[2] } : undefined;
}

export function indexReleaseIssues(issues) {
  const indexed = new Map();
  for (const issue of issues) {
    const marker = extractReleaseMarker(issue?.body);
    if (marker) indexed.set(`${marker.upstream}\0${marker.version}`, issue);
  }
  return indexed;
}

function managedSection(upstream, event) {
  const release = event.githubRelease;
  const rawTag = typeof release?.tag_name === 'string' ? release.tag_name : undefined;
  const releaseUrl = typeof release?.html_url === 'string' ? release.html_url : undefined;
  const releaseTitle = typeof release?.name === 'string' && release.name.trim()
    ? sanitizeExternalMarkdown(release.name, 500)
    : '(未提供)';
  const githubPublished = typeof release?.published_at === 'string' ? release.published_at : undefined;
  const npmPublished = event.npmPackages.map((entry) => entry.publishedAt).filter(Boolean).sort()[0];
  const publishedAt = githubPublished ?? npmPublished ?? '(未知)';
  const prerelease = release?.prerelease === true || event.version.includes('-');
  const sources = [release ? 'GitHub Release' : undefined, event.npmPackages.length ? 'npm' : undefined]
    .filter(Boolean).join(' + ');
  const baselineTag = `${upstream.tagPrefix ?? ''}${upstream.trackFrom}`;
  const comparisonTag = rawTag ?? `${upstream.tagPrefix ?? ''}${event.version}`;
  const lines = [
    `> 自动同步：检测到 **${upstream.name} ${event.version}**。外部发布内容仅作为数据搬运。`,
    '',
    '| 字段 | 值 |',
    '| --- | --- |',
    `| 上游 | ${upstream.name} |`,
    `| 仓库 | [${upstream.repository}](https://github.com/${upstream.repository}) |`,
    `| 规范化版本 | \`${event.version}\` |`,
    `| 原始 tag | ${rawTag ? `\`${rawTag}\`` : '(检查时尚无对应 GitHub Release)'} |`,
    `| 发布类型 | ${prerelease ? '预发布' : '稳定版'} |`,
    `| 发布时间 | ${publishedAt} |`,
    `| 已合并来源 | ${sources || '(无)'} |`,
    `| Release 标题 | ${releaseTitle} |`,
    '',
    '## 规范链接',
    '',
    `- GitHub Release：${releaseUrl ? `[打开 Release](${releaseUrl})` : '检查时尚无对应的 GitHub Release 详情'}`,
    `- tag / commit：${rawTag ? `[${rawTag}](https://github.com/${upstream.repository}/tree/${encodeURIComponent(rawTag)})` : '尚不可用'}`,
    `- compare / changelog：[从基线 ${upstream.trackFrom} 比较](https://github.com/${upstream.repository}/compare/${encodeURIComponent(baselineTag)}...${encodeURIComponent(comparisonTag)})`,
    ...upstream.npmPackages.map((name) => `- npm：[${name}](https://www.npmjs.com/package/${name}/v/${event.version})`),
    '',
    '## npm 发布详情',
    '',
  ];
  if (event.npmPackages.length === 0) {
    lines.push('检查时 npm 尚无对应版本。');
  } else {
    lines.push('| 包 | 发布时间 | 当前 dist-tags |', '| --- | --- | --- |');
    for (const entry of event.npmPackages) {
      const tags = Object.entries(entry.distTags)
        .map(([name, version]) => `\`${name}=${version}\``).join(', ') || '(无)';
      lines.push(`| \`${entry.name}@${event.version}\` | ${entry.publishedAt ?? '(未知)'} | ${tags} |`);
    }
  }
  if (event.sourceErrors.length > 0) {
    lines.push('', '## 来源降级', '', ...event.sourceErrors.map((error) => `- ${sanitizeExternalMarkdown(error, 500)}`));
  }
  lines.push('', '## 上游 Release notes', '');
  if (typeof release?.body === 'string' && release.body.trim()) {
    lines.push(sanitizeExternalMarkdown(release.body));
  } else if (release) {
    lines.push('上游 Release 未提供正文。');
  } else {
    lines.push('检查时尚无对应的 GitHub Release 详情；后续出现时，本 Issue 的本区块会自动补充。');
  }
  return lines.join('\n');
}

export function buildIssueBody(upstream, event) {
  return [
    releaseMarker(upstream.id, event.version),
    MANAGED_START,
    managedSection(upstream, event),
    MANAGED_END,
    '',
    '## 人工处理清单',
    '',
    '- [ ] 阅读上游发布信息',
    '- [ ] 判断本项目是否需要兼容性审计或代码更新',
    '- [ ] 如需要，另行制定实现方案 / 创建开发任务',
    '- [ ] 完成人工结论后关闭本 Issue',
    '',
    '> 责任边界：该工作流未分析本项目兼容性、未修改代码或依赖，也不代表本项目已经兼容或必须升级。',
  ].join('\n');
}

export function replaceManagedSection(body, managed) {
  const start = body.indexOf(MANAGED_START);
  const end = body.indexOf(MANAGED_END);
  if (start < 0 || end < start) return body;
  return `${body.slice(0, start + MANAGED_START.length)}\n${managed}\n${body.slice(end)}`;
}

async function responseJson(response, label) {
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new Error(`${label}: invalid JSON response`);
  }
}

export async function fetchUpstreamData(upstream, fetchImpl = fetch) {
  const githubReleases = [];
  const npmDocuments = {};
  const sourceErrors = [];
  let successfulSources = 0;
  try {
    for (let page = 1; ; page += 1) {
      const response = await fetchImpl(
        `https://api.github.com/repos/${upstream.repository}/releases?per_page=100&page=${page}`,
        {
          headers: {
            accept: 'application/vnd.github+json',
            'x-github-api-version': '2022-11-28',
            ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
          },
        },
      );
      const releases = await responseJson(response, `GitHub ${upstream.repository}`);
      if (!Array.isArray(releases)) throw new Error(`GitHub ${upstream.repository}: expected an array`);
      githubReleases.push(...releases.filter((release) => release?.draft !== true));
      if (releases.length < 100) break;
    }
    successfulSources += 1;
  } catch (error) {
    sourceErrors.push(`GitHub: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (const packageName of upstream.npmPackages) {
    try {
      const response = await fetchImpl(`https://registry.npmjs.org/${packageName}`, {
        headers: { accept: 'application/json' },
      });
      const document = await responseJson(response, `npm ${packageName}`);
      if (!document || typeof document !== 'object') throw new Error(`npm ${packageName}: expected an object`);
      npmDocuments[packageName] = document;
      successfulSources += 1;
    } catch (error) {
      sourceErrors.push(`npm ${packageName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (successfulSources === 0) {
    throw new Error(`${upstream.id}: all release sources failed (${sourceErrors.join('; ')})`);
  }
  return { githubReleases, npmDocuments, sourceErrors };
}

function assertNoCompatibilityDrift() {
  const compat = readDshCompatibility();
  let mismatch = compat.sdkClient !== compat.packageSdkClient;
  if (mismatch) {
    console.error(`drift: dsh-compat.ts sdkClient=${compat.sdkClient} but package.json pins ${compat.packageSdkClient}`);
  }
  if (compat.packageDshTools !== undefined) {
    console.error('drift: package.json must not directly depend on @deepseek-ai/dsh-tools');
    mismatch = true;
  }
  if (!compat.workshopDshVersions?.includes(compat.harness)) {
    console.error(`drift: dshWorkshop.compatibility.dshVersions does not include ${compat.harness}`);
    mismatch = true;
  }
  if (compat.staleCoreLockEntries.length > 0) {
    console.error(`drift: stale core lock entries: ${compat.staleCoreLockEntries.join(', ')}`);
    mismatch = true;
  }
  if (mismatch) throw new Error('local dsh compatibility matrix drift detected');
  return compat;
}

async function githubApi(path, options = {}) {
  const token = process.env.GITHUB_TOKEN;
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  return responseJson(response, `GitHub API ${path}`);
}

async function ensureLabel(repository) {
  const encoded = encodeURIComponent(LABEL);
  const response = await fetch(`https://api.github.com/repos/${repository}/labels/${encoded}`, {
    headers: {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    },
  });
  if (response.ok) return;
  if (response.status !== 404) throw new Error(`GitHub label lookup failed: HTTP ${response.status}`);
  await githubApi(`/repos/${repository}/labels`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: LABEL, color: '1d76db', description: 'Automated upstream release notification' }),
  });
}

async function listTrackedIssues(repository) {
  const issues = [];
  for (let page = 1; ; page += 1) {
    const batch = await githubApi(
      `/repos/${repository}/issues?state=all&labels=${encodeURIComponent(LABEL)}&per_page=100&page=${page}`,
    );
    if (!Array.isArray(batch)) throw new Error('GitHub issues response was not an array');
    issues.push(...batch.filter((issue) => !issue.pull_request));
    if (batch.length < 100) break;
  }
  return issues;
}

async function syncIssues() {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository || !process.env.GITHUB_TOKEN) {
    throw new Error('--sync-issues requires GITHUB_REPOSITORY and GITHUB_TOKEN');
  }
  assertNoCompatibilityDrift();
  await ensureLabel(repository);
  const existing = await listTrackedIssues(repository);
  const byMarker = indexReleaseIssues(existing);
  for (const upstream of UPSTREAMS) {
    const data = await fetchUpstreamData(upstream);
    for (const event of collectReleaseEvents(upstream, data)) {
      const key = `${upstream.id}\0${event.version}`;
      const current = existingIssue(byMarker, key);
      const generatedBody = buildIssueBody(upstream, event);
      if (!current) {
        const created = await githubApi(`/repos/${repository}/issues`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            title: `chore(upstream): review ${upstream.id} ${event.version}`,
            body: generatedBody,
            labels: [LABEL],
          }),
        });
        byMarker.set(key, created);
        console.log(`created ${created.html_url ?? key}`);
        continue;
      }
      const nextBody = replaceManagedSection(current.body ?? '', managedSection(upstream, event));
      if (nextBody !== current.body) {
        const updated = await githubApi(`/repos/${repository}/issues/${current.number}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ body: nextBody }),
        });
        byMarker.set(key, updated);
        console.log(`updated ${updated.html_url ?? key}`);
      } else {
        console.log(`unchanged ${current.html_url ?? key}`);
      }
    }
  }
}

function existingIssue(byMarker, key) {
  return byMarker.get(key);
}

async function report() {
  const compat = assertNoCompatibilityDrift();
  console.log(`compat matrix verified at ${compat.verifiedAt} (node ${compat.node})`);
  let newerThanPin = false;
  for (const upstream of UPSTREAMS) {
    const data = await fetchUpstreamData(upstream);
    const events = collectReleaseEvents(upstream, data);
    console.log(`${upstream.id}: baseline ${upstream.trackFrom}; ${events.length} newer release(s)`);
    for (const event of events) console.log(`  - ${event.version}`);
    if (upstream.id === 'dsh') {
      for (const document of Object.values(data.npmDocuments)) {
        for (const version of Object.keys(document.versions ?? {})) {
          newerThanPin ||= compareVersions(version, compat.harness) > 0;
        }
      }
    }
  }
  if (newerThanPin) console.log('A dsh release newer than the pinned compatibility matrix exists.');
  if (newerThanPin && process.argv.includes('--fail-on-upgrade')) process.exitCode = 1;
}

async function main() {
  if (process.argv.includes('--sync-issues')) await syncIssues();
  else await report();
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
