import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
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
});
