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
      expect(result.cwd).toBe(join(worktreesRoot, 'chat-thread-1'));
      expect(result.branch).toMatch(/^dsh-lark\/chat-thread-1-/);
      expect(calls[1]).toEqual([
        'worktree',
        'add',
        '-b',
        expect.stringMatching(/^dsh-lark\/chat-thread-1-/),
        join(worktreesRoot, 'chat-thread-1'),
        'HEAD',
      ]);
      expect(copied[0]).toEqual({
        source: join(base, 'AGENTS.md'),
        target: join(worktreesRoot, 'chat-thread-1', 'AGENTS.md'),
      });
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
});
