import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { log } from '../core/logger.js';
import type { ChatMessage } from './store.js';

const execFileAsync = promisify(execFile);

export type ArchiveSource = 'manual' | 'retention';

export interface ArchiveRecord {
  /** Stable archive id: `20260815T020000Z-<short hex>`. */
  archiveId: string;
  scope: string;
  cwd: string | undefined;
  source: ArchiveSource;
  note: string | undefined;
  messageCount: number;
  archivedAt: string;
  jsonlPath: string;
  markdownPath: string;
  gitCommit: string | undefined;
}

export interface ArchiveInput {
  scope: string;
  cwd: string | undefined;
  messages: readonly ChatMessage[];
  source?: ArchiveSource;
  note?: string;
}

export interface ArchivePruneOptions {
  /** Keep at most this many archives per scope (oldest removed first). */
  maxArchives?: number;
  /** Remove archives older than this many milliseconds. */
  maxAgeMs?: number;
}

function slugify(scope: string): string {
  const slug = scope
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[.]+/, '')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || 'session';
}

function timestampId(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return `${stamp}-${randomBytes(3).toString('hex')}`;
}

function renderMarkdown(
  input: ArchiveInput,
  record: { archiveId: string; archivedAt: string; source: ArchiveSource },
): string {
  const lines: string[] = [
    `# dsh-lark-bot 会话归档 · Session Archive`,
    '',
    `- archiveId: \`${record.archiveId}\``,
    `- scope: \`${input.scope}\``,
    ...(input.cwd ? [`- cwd: \`${input.cwd}\``] : []),
    `- source: ${record.source}`,
    `- archivedAt: ${record.archivedAt}`,
    ...(input.note ? [`- note: ${input.note}`] : []),
    '',
  ];
  if (input.messages.length === 0) {
    lines.push('*(no messages)*');
  }
  for (const message of input.messages) {
    const speaker =
      message.role === 'user'
        ? 'User'
        : 'Assistant';
    lines.push(`## ${speaker}`, '', message.content, '');
  }
  return `${lines.join('\n')}\n`;
}

function renderJsonl(input: ArchiveInput, record: { archiveId: string; archivedAt: string; source: ArchiveSource }): string {
  const header = {
    type: 'dsh-lark-archive',
    schemaVersion: 1,
    archiveId: record.archiveId,
    scope: input.scope,
    cwd: input.cwd,
    source: record.source,
    note: input.note,
    archivedAt: record.archivedAt,
  };
  const rows = [
    JSON.stringify(header),
    ...input.messages.map((message) =>
      JSON.stringify({
        role: message.role,
        content: message.content,
      }),
    ),
  ];
  return `${rows.join('\n')}\n`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Durable session/task archival: every archive is written as a human-readable
 * Markdown transcript plus a machine-readable JSONL payload under
 * `<profile>/archives/<scope-slug>/`. When `git` is available, the archive
 * root is lazily initialized as its own Git repository and each archive is
 * committed, giving an auditable, replayable history that survives local
 * retention trimming.
 */
export class SessionArchive {
  private gitInitialized: boolean | undefined;

  constructor(
    private readonly archiveDir: string,
    private readonly runGit: (args: string[], cwd: string) => Promise<string> = defaultRunGit,
  ) {}

  async archive(input: ArchiveInput): Promise<ArchiveRecord> {
    const scopeSlug = slugify(input.scope);
    const id = timestampId();
    const archivedAt = new Date().toISOString();
    const source = input.source ?? 'manual';
    const scopeDir = join(this.archiveDir, scopeSlug);
    const jsonlPath = join(scopeDir, `${id}.jsonl`);
    const markdownPath = join(scopeDir, `${id}.md`);
    await mkdir(scopeDir, { recursive: true });
    await Promise.all([
      writeFile(jsonlPath, renderJsonl(input, { archiveId: id, archivedAt, source }), 'utf8'),
      writeFile(
        markdownPath,
        renderMarkdown(input, { archiveId: id, archivedAt, source }),
        'utf8',
      ),
    ]);

    let gitCommit: string | undefined;
    try {
      await this.ensureGit();
      await this.runGit(['add', '-A', '.'], this.archiveDir);
      await this.runGit(
        ['commit', '-m', `archive ${id} (${source}, ${String(input.messages.length)} messages)`, '--no-verify'],
        this.archiveDir,
      );
      gitCommit = (await this.runGit(['rev-parse', '--short', 'HEAD'], this.archiveDir)).trim();
    } catch (error) {
      // Git is an optional transport: files are already durable on disk.
      log.warn('archive', 'git-commit-failed', {
        scope: input.scope,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      archiveId: id,
      scope: input.scope,
      cwd: input.cwd,
      source,
      note: input.note,
      messageCount: input.messages.length,
      archivedAt,
      jsonlPath,
      markdownPath,
      gitCommit,
    };
  }

  async list(scope?: string): Promise<ArchiveRecord[]> {
    const records: ArchiveRecord[] = [];
    const scopeDirs: Array<{ name: string; dir: string }> = [];
    if (scope === undefined) {
      if (!(await exists(this.archiveDir))) return [];
      for (const entry of await readdir(this.archiveDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        scopeDirs.push({ name: entry.name, dir: join(this.archiveDir, entry.name) });
      }
    } else {
      const dir = join(this.archiveDir, slugify(scope));
      if (!(await exists(dir))) return [];
      scopeDirs.push({ name: slugify(scope), dir });
    }
    for (const entry of scopeDirs) {
      const dir = entry.dir;
      const files = await readdir(dir);
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        const id = file.slice(0, -'.md'.length);
        const markdownPath = join(dir, file);
        const jsonlPath = join(dir, `${id}.jsonl`);
        const header = await readArchiveHeader(jsonlPath);
        if (!header) continue;
        records.push({
          archiveId: id,
          scope: header.scope ?? entry.name,
          cwd: header.cwd,
          source: header.source ?? 'manual',
          note: header.note,
          messageCount: header.messageCount ?? 0,
          archivedAt: header.archivedAt ?? '',
          jsonlPath,
          markdownPath,
          gitCommit: undefined,
        });
      }
    }
    return records.sort(
      (a, b) =>
        b.archivedAt.localeCompare(a.archivedAt) ||
        b.archiveId.localeCompare(a.archiveId),
    );
  }

  /** Remove archives beyond per-scope count/age limits. Returns the number removed. */
  async prune(options: ArchivePruneOptions = {}): Promise<number> {
    const records = await this.list();
    const byScope = new Map<string, ArchiveRecord[]>();
    for (const record of records) {
      const bucket = byScope.get(record.scope) ?? [];
      bucket.push(record);
      byScope.set(record.scope, bucket);
    }
    const now = Date.now();
    let removed = 0;
    for (const [scope, scoped] of byScope) {
      // Newest first: prune from the oldest end while keeping the newest
      // `maxArchives` records within the age window.
      const ordered = [...scoped].sort(
        (a, b) =>
          b.archivedAt.localeCompare(a.archivedAt) ||
          b.archiveId.localeCompare(a.archiveId),
      );
      const keep: ArchiveRecord[] = [];
      let keptCount = 0;
      for (const record of ordered) {
        const tooOld =
          options.maxAgeMs !== undefined &&
          record.archivedAt !== '' &&
          now - Date.parse(record.archivedAt) > options.maxAgeMs;
        const beyondCount =
          options.maxArchives !== undefined &&
          keptCount >= options.maxArchives;
        if (tooOld || beyondCount) {
          await safeRemove(record.markdownPath);
          await safeRemove(record.jsonlPath);
          removed += 1;
          log.info('archive', 'pruned', { scope, archiveId: record.archiveId });
        } else {
          keep.push(record);
          keptCount += 1;
        }
      }
    }
    if (removed > 0) {
      try {
        await this.ensureGit();
        await this.runGit(['add', '-A', '.'], this.archiveDir);
        await this.runGit(['commit', '-m', `prune ${String(removed)} archives`, '--no-verify'], this.archiveDir);
      } catch (error) {
        log.warn('archive', 'git-prune-commit-failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return removed;
  }

  private async ensureGit(): Promise<void> {
    if (this.gitInitialized !== undefined) return;
    await mkdir(this.archiveDir, { recursive: true });
    if (!(await exists(join(this.archiveDir, '.git')))) {
      await this.runGit(['init', '-q'], this.archiveDir);
      try {
        await this.runGit(['config', 'user.name', 'dsh-lark-bot'], this.archiveDir);
        await this.runGit(['config', 'user.email', 'dsh-lark-bot@localhost'], this.archiveDir);
      } catch {
        // Local git identity is optional; commits fall back to global config.
      }
    }
    this.gitInitialized = true;
  }
}

async function defaultRunGit(args: string[], cwd: string): Promise<string> {
  const result = await execFileAsync('git', args, { cwd, encoding: 'utf8' });
  return result.stdout;
}

interface ArchiveHeader {
  scope?: string;
  cwd?: string;
  source?: ArchiveSource;
  note?: string;
  messageCount?: number;
  archivedAt?: string;
}

async function readArchiveHeader(jsonlPath: string): Promise<ArchiveHeader | undefined> {
  try {
    const raw = await readFile(jsonlPath, 'utf8');
    const firstLine = raw.split('\n', 1)[0];
    if (!firstLine) return undefined;
    const header = JSON.parse(firstLine) as Record<string, unknown>;
    if (header.type !== 'dsh-lark-archive') return undefined;
    const parsed: ArchiveHeader = {};
    if (typeof header.scope === 'string') parsed.scope = header.scope;
    if (typeof header.cwd === 'string') parsed.cwd = header.cwd;
    if (header.source === 'manual' || header.source === 'retention') parsed.source = header.source;
    if (typeof header.note === 'string') parsed.note = header.note;
    if (typeof header.messageCount === 'number') parsed.messageCount = header.messageCount;
    if (typeof header.archivedAt === 'string') parsed.archivedAt = header.archivedAt;
    return parsed;
  } catch {
    return undefined;
  }
}

async function safeRemove(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // Best effort; the archive file may already be gone.
  }
}

export function archiveDisplay(record: ArchiveRecord): string {
  const commit = record.gitCommit ? ` (git ${record.gitCommit})` : '';
  return `\`${record.archiveId}\` · ${record.messageCount} msgs · ${record.source}${commit}`;
}
