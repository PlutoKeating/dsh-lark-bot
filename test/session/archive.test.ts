import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { SessionArchive } from '../../src/session/archive.js';

describe('SessionArchive', () => {
  it('writes markdown + jsonl transcripts and lists records', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-archive-'));
    try {
      const archive = new SessionArchive(join(root, 'archives'));
      const record = await archive.archive({
        scope: 'oc_group:thread-1',
        cwd: '/tmp/project',
        messages: [
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: 'hi' },
        ],
        source: 'manual',
        note: 'kickoff',
      });

      expect(record.messageCount).toBe(2);
      expect(await stat(record.markdownPath)).toBeDefined();
      expect(await stat(record.jsonlPath)).toBeDefined();

      const md = await readFile(record.markdownPath, 'utf8');
      expect(md).toContain('## User');
      expect(md).toContain('hello');
      expect(md).toContain('## Assistant');
      expect(md).toContain('hi');

      const jsonl = await readFile(record.jsonlPath, 'utf8');
      expect(jsonl.split('\n').filter((line) => line.length > 0)).toHaveLength(3); // header + 2 messages

      const listed = await archive.list('oc_group:thread-1');
      expect(listed).toHaveLength(1);
      expect(listed[0]?.source).toBe('manual');
      expect(listed[0]?.note).toBe('kickoff');
      expect(listed[0]?.scope).toBe('oc_group:thread-1');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('commits archives to a lazily initialized git repository', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-archive-git-'));
    const gitCalls: string[][] = [];
    const runGit = vi.fn(async (args: string[]) => {
      gitCalls.push(args);
      if (args[0] === 'rev-parse') return 'abc123\n';
      return '';
    });
    try {
      const archive = new SessionArchive(join(root, 'archives'), runGit as never);
      const record = await archive.archive({
        scope: 'chat-a',
        cwd: undefined,
        messages: [{ role: 'user', content: 'x' }],
      });
      expect(record.gitCommit).toBe('abc123');
      expect(gitCalls.some((args) => args[0] === 'init')).toBe(true);
      expect(gitCalls.some((args) => args[0] === 'commit')).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('prunes old and excess archives per scope', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-archive-prune-'));
    try {
      const archive = new SessionArchive(join(root, 'archives'), async () => '');
      const first = await archive.archive({
        scope: 'chat-a',
        cwd: undefined,
        messages: [{ role: 'user', content: 'a' }],
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const second = await archive.archive({
        scope: 'chat-a',
        cwd: undefined,
        messages: [{ role: 'user', content: 'b' }],
      });

      const removed = await archive.prune({ maxArchives: 1 });
      expect(removed).toBe(1);
      const remaining = await archive.list('chat-a');
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.archiveId).not.toBe(first.archiveId);
      await expect(stat(second.markdownPath)).resolves.toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('lists and prunes only the selected workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-archive-workspace-'));
    try {
      const archive = new SessionArchive(join(root, 'archives'), async () => '');
      await archive.archive({
        scope: 'chat-a', cwd: '/tmp/a', messages: [{ role: 'user', content: 'a1' }],
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
      await archive.archive({
        scope: 'chat-a', cwd: '/tmp/a', messages: [{ role: 'user', content: 'a2' }],
      });
      await archive.archive({
        scope: 'chat-a', cwd: '/tmp/b', messages: [{ role: 'user', content: 'b1' }],
      });

      expect(await archive.list('chat-a', '/tmp/b')).toHaveLength(1);
      expect(await archive.prune({ scope: 'chat-a', cwd: '/tmp/a', maxArchives: 1 })).toBe(1);
      expect(await archive.list('chat-a', '/tmp/a')).toHaveLength(1);
      expect(await archive.list('chat-a', '/tmp/b')).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rebinds legacy execution-cwd archives to the canonical project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-archive-migrate-'));
    const gitCalls: string[][] = [];
    try {
      const archive = new SessionArchive(join(root, 'archives'), async (args) => {
        gitCalls.push(args);
        return '';
      });
      const record = await archive.archive({
        scope: 'chat-a',
        cwd: '/profiles/default/worktrees/chat-a',
        messages: [{ role: 'user', content: 'legacy' }],
        source: 'retention',
      });
      const other = await archive.archive({
        scope: 'chat-a',
        cwd: '/projects/repo-b',
        messages: [{
          role: 'user',
          content: 'Do not rewrite this transcript line:\n- cwd: `/profiles/default/worktrees/chat-a`',
        }],
        source: 'retention',
      });
      const otherBefore = await readFile(other.markdownPath, 'utf8');

      expect(await archive.rebindWorkspaceCwd(
        'chat-a',
        '/profiles/default/worktrees/chat-a',
        '/projects/repo-a',
      )).toBe(1);
      expect(await archive.list('chat-a', '/profiles/default/worktrees/chat-a')).toEqual([]);
      expect(await archive.list('chat-a', '/projects/repo-a')).toHaveLength(1);
      expect(await readFile(record.markdownPath, 'utf8')).toContain('- cwd: `/projects/repo-a`');
      expect(await readFile(other.markdownPath, 'utf8')).toBe(otherBefore);
      expect(await archive.list('chat-a', '/projects/repo-b')).toHaveLength(1);

      // Simulate a crash after JSONL replacement but before Markdown. The
      // retry must detect the stale sibling even though list() sees new cwd.
      const migratedMarkdown = await readFile(record.markdownPath, 'utf8');
      await writeFile(
        record.markdownPath,
        migratedMarkdown.replace('/projects/repo-a', '/profiles/default/worktrees/chat-a'),
      );
      expect(await archive.rebindWorkspaceCwd(
        'chat-a',
        '/profiles/default/worktrees/chat-a',
        '/projects/repo-a',
      )).toBe(1);
      expect(await readFile(record.markdownPath, 'utf8')).toContain('- cwd: `/projects/repo-a`');
      expect(gitCalls.some((args) => args[0] === 'commit' && args[2]?.startsWith('migrate '))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails migration when an archive pair is incomplete so schema adoption can retry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-archive-incomplete-'));
    try {
      const archive = new SessionArchive(join(root, 'archives'), async () => '');
      const record = await archive.archive({
        scope: 'chat-a',
        cwd: '/profiles/default/worktrees/chat-a',
        messages: [{ role: 'user', content: 'legacy' }],
        source: 'retention',
      });
      await rm(record.markdownPath);

      await expect(archive.rebindWorkspaceCwd(
        'chat-a',
        '/profiles/default/worktrees/chat-a',
        '/projects/repo-a',
      )).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
