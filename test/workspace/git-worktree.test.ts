import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { GitWorktreeManager } from '../../src/workspace/git-worktree.js';

describe('GitWorktreeManager', () => {
  it('creates an isolated worktree with a deterministic branch prefix and injects project rules', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-worktree-'));
    const base = join(root, 'repo');
    await mkdir(base, { recursive: true });
    await writeFile(join(base, 'AGENTS.md'), '# project rules\n');

    const calls: string[][] = [];
    const copied: Array<{ source: string; target: string }> = [];
    try {
      const worktreesRoot = join(root, 'worktrees');
      const manager = new GitWorktreeManager({
        worktreesRoot,
        runGit: async (args) => {
          calls.push(args);
          if (args[0] === 'rev-parse') return 'true';
          return '';
        },
        copyRulesFile: async (source, target) => {
          copied.push({ source, target });
        },
      });

      const result = await manager.ensure('chat:thread:1', base);

      expect(result.created).toBe(true);
      expect(result.cwd).toMatch(new RegExp(`${worktreesRoot}/chat-thread-1-[a-f0-9]{10}$`));
      expect(result.branch).toMatch(/^dsh-lark\/chat-thread-1-/);
      expect(calls[1]).toEqual([
        'worktree',
        'add',
        '-b',
        expect.stringMatching(/^dsh-lark\/chat-thread-1-/),
        result.cwd,
        'HEAD',
      ]);
      expect(copied[0]).toEqual({
        source: join(base, 'AGENTS.md'),
        target: join(result.cwd, 'AGENTS.md'),
      });

      const other = await manager.ensure('chat:thread:1', join(root, 'other-repo'));
      expect(other.cwd).not.toBe(result.cwd);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('returns the base directory unchanged for non-git projects', async () => {
    const manager = new GitWorktreeManager({
      worktreesRoot: '/tmp/worktrees',
      runGit: async () => {
        throw new Error('not a git repository');
      },
      copyRulesFile: vi.fn(),
    });

    await expect(manager.ensure('chat-a', '/tmp/plain-project')).resolves.toEqual({
      cwd: '/tmp/plain-project',
      created: false,
    });
  });

  it('moves a legacy scope-only worktree to the path-hashed target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-worktree-migrate-'));
    const base = join(root, 'repo');
    const worktreesRoot = join(root, 'worktrees');
    const legacy = join(worktreesRoot, 'chat-a');
    await mkdir(base, { recursive: true });
    await mkdir(legacy, { recursive: true });
    const calls: string[][] = [];
    try {
      const manager = new GitWorktreeManager({
        worktreesRoot,
        runGit: async (args) => {
          calls.push(args);
          if (args[0] === 'rev-parse') return 'true';
          if (args[0] === 'worktree' && args[1] === 'list') {
            return `worktree ${base}\nHEAD abc123\nbranch refs/heads/main\n\nworktree ${legacy}\nHEAD def456\nbranch refs/heads/legacy\n`;
          }
          return '';
        },
        copyRulesFile: vi.fn(),
      });

      const result = await manager.ensure('chat-a', base);

      expect(result).toEqual({
        cwd: expect.stringMatching(/worktrees\/chat-a-[a-f0-9]{10}$/),
        created: false,
      });
      expect(calls).toContainEqual(['worktree', 'move', legacy, result.cwd]);
      expect(calls.some((args) => args[1] === 'add')).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('preserves a legacy worktree owned by repo A while creating repo B independently', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-worktree-owner-'));
    const repoA = join(root, 'repo-a');
    const repoB = join(root, 'repo-b');
    const worktreesRoot = join(root, 'worktrees');
    const legacy = join(worktreesRoot, 'chat-a');
    await Promise.all([
      mkdir(repoA, { recursive: true }),
      mkdir(repoB, { recursive: true }),
      mkdir(legacy, { recursive: true }),
    ]);
    const calls: string[][] = [];
    try {
      const manager = new GitWorktreeManager({
        worktreesRoot,
        runGit: async (args) => {
          calls.push(args);
          if (args[0] === 'rev-parse') return 'true';
          if (args[0] === 'worktree' && args[1] === 'list') {
            return `worktree ${repoA}\nHEAD abc123\n\nworktree ${legacy}\nHEAD def456\n`;
          }
          return '';
        },
        copyRulesFile: vi.fn(),
      });

      expect(await manager.legacyWorkspaceBase('chat-a')).toBe(repoA);
      const result = await manager.ensure('chat-a', repoB);

      expect(result.created).toBe(true);
      expect(calls).not.toContainEqual(['worktree', 'move', legacy, result.cwd]);
      expect(calls.some((args) => args[0] === 'worktree' && args[1] === 'add')).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
