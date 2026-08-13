import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

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

    const slug = slugify(scope);
    const target = join(this.options.worktreesRoot, slug);
    if (await exists(target)) {
      await this.ensureProjectRules(base, target);
      return { cwd: target, created: false };
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
