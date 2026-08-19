import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { access, copyFile, mkdir, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { isPathWithin } from '../config/security.js';

const execFileAsync = promisify(execFile);

export type GitRunner = (args: string[], cwd: string) => Promise<string>;

export interface WorktreeEnsureResult {
  cwd: string;
  created: boolean;
  branch?: string;
}

export interface GitWorktreeOptions {
  worktreesRoot: string;
  runGit?: GitRunner;
  copyRulesFile?: (source: string, target: string) => Promise<void>;
}

async function defaultRunGit(args: string[], cwd: string): Promise<string> {
  const result = await execFileAsync('git', args, {
    cwd,
    encoding: 'utf8',
  });
  return result.stdout;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function defaultCopyRulesFile(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
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

export class GitWorktreeManager {
  private readonly runGit: GitRunner;
  private readonly copyRulesFile: (source: string, target: string) => Promise<void>;

  constructor(private readonly options: GitWorktreeOptions) {
    this.runGit = options.runGit ?? defaultRunGit;
    this.copyRulesFile = options.copyRulesFile ?? defaultCopyRulesFile;
  }

  async ensure(scope: string, base: string): Promise<WorktreeEnsureResult> {
    const isGit = await this.isGitRepository(base);
    if (!isGit) return { cwd: base, created: false };

    // One scope may switch between repositories. Include the canonical base
    // path so each project keeps a stable, independent worktree.
    const scopeSlug = slugify(scope);
    const project = createHash('sha256').update(base).digest('hex').slice(0, 10);
    const slug = `${scopeSlug}-${project}`;
    const target = join(this.options.worktreesRoot, slug);
    if (!isPathWithin(this.options.worktreesRoot, target)) {
      throw new Error(`unsafe worktree target rejected: ${target}`);
    }
    if (await exists(target)) {
      await this.ensureProjectRules(base, target);
      return { cwd: target, created: false };
    }

    // v1 used only the scope slug. Move that registered worktree instead of
    // creating a blank replacement, preserving its branch and uncommitted
    // files during the schema-2 workspace migration.
    const legacyTarget = join(this.options.worktreesRoot, scopeSlug);
    if (await exists(legacyTarget)) {
      const legacyBase = await this.legacyWorkspaceBase(scope);
      if (legacyBase !== undefined && await samePath(legacyBase, base)) {
        await mkdir(this.options.worktreesRoot, { recursive: true });
        await this.runGit(['worktree', 'move', legacyTarget, target], legacyTarget);
        await this.ensureProjectRules(base, target);
        return { cwd: target, created: false };
      }
      // The old scope-only worktree can belong to another repository when an
      // old /cd changed WorkspaceStore but reused the first project's tree.
      // Leave it intact; create this project's hashed tree independently.
    }

    const branch = `dsh-lark/${slug}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
    await mkdir(this.options.worktreesRoot, { recursive: true });
    await this.runGit(['worktree', 'add', '-b', branch, target, 'HEAD'], base);
    await this.ensureProjectRules(base, target);
    return { cwd: target, created: true, branch };
  }

  async isGitRepository(cwd: string): Promise<boolean> {
    try {
      const result = await this.runGit(['rev-parse', '--is-inside-work-tree'], cwd);
      return result.trim() === 'true';
    } catch {
      return false;
    }
  }

  /** Owning main worktree for the legacy scope-only linked worktree. */
  async legacyWorkspaceBase(scope: string): Promise<string | undefined> {
    const legacyTarget = join(this.options.worktreesRoot, slugify(scope));
    if (!(await exists(legacyTarget))) return undefined;
    try {
      const output = await this.runGit(['worktree', 'list', '--porcelain'], legacyTarget);
      const first = output.split('\n').find((line) => line.startsWith('worktree '));
      const path = first?.slice('worktree '.length).trim();
      return path || undefined;
    } catch {
      return undefined;
    }
  }

  private async ensureProjectRules(base: string, target: string): Promise<void> {
    const destination = join(target, 'AGENTS.md');
    if (await exists(destination)) return;

    const sourceCandidates = [join(base, '.dsh-lark', 'AGENTS.md'), join(base, 'AGENTS.md')];
    for (const source of sourceCandidates) {
      if (await exists(source)) {
        await this.copyRulesFile(source, destination);
        return;
      }
    }
  }
}

async function samePath(left: string, right: string): Promise<boolean> {
  try {
    return await realpath(left) === await realpath(right);
  } catch {
    return false;
  }
}
