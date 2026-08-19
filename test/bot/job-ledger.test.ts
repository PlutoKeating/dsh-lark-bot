import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JobLedger, type DurableQueuedMessage } from '../../src/bot/job-ledger.js';

function message(messageId: string, overrides: Partial<DurableQueuedMessage> = {}): DurableQueuedMessage {
  return {
    messageId,
    scope: 'chat-a',
    workspaceCwd: '/repo-a',
    chatId: 'chat-a',
    chatType: 'p2p',
    senderId: 'user-a',
    senderType: 'user',
    content: `message ${messageId}`,
    rawContentType: 'text',
    resources: [],
    mentions: [],
    mentionAll: false,
    mentionedBot: true,
    createTime: 1,
    ...overrides,
  };
}

describe('JobLedger', () => {
  it('durably enqueues before exposing a queued record and deduplicates message ids', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-job-ledger-'));
    const path = join(dir, 'jobs.json');
    const ledger = new JobLedger(path, { now: () => 10 });
    await ledger.load();

    await expect(ledger.enqueue(message('m1'))).resolves.toBe(true);
    await expect(ledger.enqueue(message('m1'))).resolves.toBe(false);
    expect(ledger.queued().map((record) => record.message.messageId)).toEqual(['m1']);
    expect(JSON.parse(await readFile(path, 'utf8')).records.m1.state).toBe('queued');
  });

  it('marks an in-flight job interrupted on restart and preserves its last safe checkpoint', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-job-ledger-'));
    const path = join(dir, 'jobs.json');
    const ledger = new JobLedger(path, { now: () => 20 });
    await ledger.load();
    await ledger.enqueue(message('m1'));
    await ledger.markRunning(['m1'], 'run-a');
    await ledger.checkpoint(['m1'], { stage: 'tool', detail: 'bash', nativeSessionId: 'session-a' });

    const restarted = new JobLedger(path, { now: () => 30 });
    await restarted.load();
    const interrupted = await restarted.recoverInterrupted();

    expect(interrupted).toHaveLength(1);
    expect(interrupted[0]).toMatchObject({
      state: 'interrupted', runId: 'run-a', checkpoint: { stage: 'tool', detail: 'bash' },
    });
    expect(restarted.queued()).toEqual([]);
  });

  it('requeues an interrupted record explicitly without losing its immutable routing snapshot', async () => {
    const ledger = new JobLedger(':memory:', { now: () => 40 });
    await ledger.load();
    await ledger.enqueue(message('m1', { threadId: 'thread-a' }));
    await ledger.markRunning(['m1'], 'run-a');
    await ledger.recoverInterrupted();

    const retried = await ledger.retry('m1', 'chat-a', '/repo-a');
    expect(retried?.message).toMatchObject({
      messageId: 'm1', scope: 'chat-a', threadId: 'thread-a', workspaceCwd: '/repo-a',
    });
    expect(retried?.state).toBe('queued');
    expect(retried?.attempts).toBe(2);
  });

  it('keeps scope and workspace accounting isolated', async () => {
    const ledger = new JobLedger(':memory:');
    await ledger.load();
    await ledger.enqueue(message('a'));
    await ledger.enqueue(message('b', { workspaceCwd: '/repo-b' }));
    await ledger.enqueue(message('c', { scope: 'chat-b', chatId: 'chat-b' }));
    await ledger.markRunning(['a'], 'run-a');
    await ledger.finish(['a'], 'completed');

    expect(ledger.counts('chat-a', '/repo-a')).toEqual({
      queued: 0, running: 0, completed: 1, failed: 0, interrupted: 0,
    });
    expect(ledger.counts('chat-a', '/repo-b').queued).toBe(1);
    expect(ledger.list('chat-b', '/repo-a', 10)).toHaveLength(1);
  });

  it('rejects an untracked dispatch without partially changing other records', async () => {
    const ledger = new JobLedger(':memory:');
    await ledger.enqueue(message('m1'));

    await expect(ledger.markRunning(['m1', 'missing'], 'run-a')).rejects.toThrow('missing');
    expect(ledger.get('m1', 'chat-a', '/repo-a')?.state).toBe('queued');
  });

  it('moves a corrupt ledger aside so startup can continue with an auditable backup', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-job-ledger-'));
    const path = join(dir, 'jobs.json');
    await writeFile(path, '{broken', 'utf8');
    const ledger = new JobLedger(path, { now: () => 55 });

    await expect(ledger.load()).resolves.toBeUndefined();
    expect(ledger.list('chat-a', '/repo-a', 10)).toEqual([]);
    expect(await readFile(`${path}.corrupt-55`, 'utf8')).toBe('{broken');
  });
});
