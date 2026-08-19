import { describe, expect, it, vi } from 'vitest';
import { JobLedger, type DurableQueuedMessage } from '../../src/bot/job-ledger.js';
import {
  claimJobDispatch,
  prepareDurableJobRecovery,
  persistJobTerminal,
  persistJobTerminalAndNotify,
  recoverDurableJobs,
} from '../../src/bridge/job-recovery.js';

function message(messageId: string, threadId?: string): DurableQueuedMessage {
  return {
    messageId,
    scope: threadId ? `chat-a:${threadId}` : 'chat-a',
    workspaceCwd: '/repo-a',
    chatId: 'chat-a',
    chatType: 'group',
    chatMode: threadId ? 'topic' : 'group',
    senderId: 'user-a',
    senderType: 'user',
    content: `message ${messageId}`,
    rawContentType: 'text',
    resources: [],
    mentions: [],
    mentionAll: false,
    mentionedBot: true,
    ...(threadId ? { threadId } : {}),
    createTime: 1,
  };
}

describe('recoverDurableJobs', () => {
  it('replays queued messages and requires explicit retry for interrupted work', async () => {
    const jobs = new JobLedger(':memory:');
    await jobs.enqueue(message('queued', 'thread-a'));
    await jobs.enqueue(message('running'));
    await jobs.markRunning(['running'], 'run-a');
    await jobs.checkpoint(['running'], { stage: 'tool', detail: 'bash' });
    const push = vi.fn();
    const sendMarkdown = vi.fn().mockResolvedValue(undefined);

    const plan = await prepareDurableJobRecovery(jobs);
    expect(jobs.get('running', 'chat-a', '/repo-a')?.state).toBe('running');
    // Simulate a live event arriving after the channel connects. It is not in
    // the frozen recovery plan and must be queued only by the live handler.
    await jobs.enqueue(message('live'));
    const summary = await recoverDurableJobs(plan, jobs, { push }, { sendMarkdown });

    expect(summary).toEqual({ queued: 1, interrupted: 1 });
    expect(push).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledWith('chat-a:thread-a', expect.objectContaining({
      messageId: 'queued', workspaceCwd: '/repo-a', threadId: 'thread-a',
    }));
    expect(sendMarkdown).toHaveBeenCalledWith(
      'chat-a',
      expect.stringContaining('queued'),
      { replyTo: 'queued', threadId: 'thread-a' },
    );
    expect(sendMarkdown).toHaveBeenCalledWith(
      'chat-a',
      expect.stringMatching(/running[\s\S]*jobs retry running/),
      { replyTo: 'running' },
    );
    expect(jobs.get('running', 'chat-a', '/repo-a')?.state).toBe('interrupted');
    expect(jobs.get('live', 'chat-a', '/repo-a')?.state).toBe('queued');
  });

  it('keeps a running receipt recoverable when startup stops before outbound readiness', async () => {
    const jobs = new JobLedger(':memory:');
    await jobs.enqueue(message('running'));
    await jobs.markRunning(['running'], 'run-a');

    await prepareDurableJobRecovery(jobs);
    expect(jobs.get('running', 'chat-a', '/repo-a')?.state).toBe('running');

    const nextPlan = await prepareDurableJobRecovery(jobs);
    const sendMarkdown = vi.fn().mockResolvedValue(undefined);
    await recoverDurableJobs(nextPlan, jobs, { push: vi.fn() }, { sendMarkdown });

    expect(sendMarkdown).toHaveBeenCalledWith(
      'chat-a',
      expect.stringContaining('jobs retry running'),
      { replyTo: 'running' },
    );
    expect(jobs.pendingRecoveryNotices()).toEqual([]);
  });

  it('retries an interrupted reconciliation notice after delivery fails', async () => {
    const jobs = new JobLedger(':memory:');
    await jobs.enqueue(message('running'));
    await jobs.markRunning(['running'], 'run-a');
    const plan = await prepareDurableJobRecovery(jobs);
    const sendMarkdown = vi.fn().mockRejectedValueOnce(new Error('offline'));

    await recoverDurableJobs(plan, jobs, { push: vi.fn() }, { sendMarkdown });
    expect(jobs.pendingRecoveryNotices()).toHaveLength(1);

    const retryPlan = await prepareDurableJobRecovery(jobs);
    sendMarkdown.mockResolvedValueOnce(undefined);
    await recoverDurableJobs(retryPlan, jobs, { push: vi.fn() }, { sendMarkdown });
    expect(sendMarkdown).toHaveBeenCalledTimes(2);
    expect(jobs.pendingRecoveryNotices()).toEqual([]);
  });

  it('marks an unexecuted dispatch failed when the fallback receipt persists', async () => {
    const sendMarkdown = vi.fn().mockResolvedValue(undefined);
    const finish = vi.fn().mockResolvedValue(undefined);
    const result = await claimJobDispatch({
      jobs: {
        markRunning: vi.fn().mockRejectedValue(new Error('disk full')),
        finish,
      },
      messageIds: ['m1'],
      runId: 'dispatch-a',
      first: { chatId: 'chat-a', messageId: 'm1' },
      channel: { sendMarkdown },
    });

    expect(result).toBe(false);
    expect(finish).toHaveBeenCalledWith(
      ['m1'],
      'failed',
      'dispatch receipt failed: disk full',
    );
    expect(sendMarkdown).toHaveBeenCalledWith(
      'chat-a',
      expect.stringMatching(/尚未执行[\s\S]*jobs retry m1/),
      { replyTo: 'm1' },
    );
  });

  it('reports queued replay semantics when no dispatch state can persist', async () => {
    const sendMarkdown = vi.fn().mockResolvedValue(undefined);
    const result = await claimJobDispatch({
      jobs: {
        markRunning: vi.fn().mockRejectedValue(new Error('disk full')),
        finish: vi.fn().mockRejectedValue(new Error('still full')),
      },
      messageIds: ['m1'],
      runId: 'dispatch-a',
      first: { chatId: 'chat-a', messageId: 'm1', threadId: 'thread-a' },
      channel: { sendMarkdown },
    });

    expect(result).toBe(false);
    expect(sendMarkdown).toHaveBeenCalledWith(
      'chat-a',
      expect.stringMatching(/仍为 queued[\s\S]*重启 bridge/),
      { replyTo: 'm1', threadId: 'thread-a' },
    );
  });

  it('warns without throwing when the terminal snapshot cannot be persisted', async () => {
    const sendMarkdown = vi.fn().mockResolvedValue(undefined);
    const persisted = await persistJobTerminal({
      jobs: { finish: vi.fn().mockRejectedValue(new Error('disk full')) },
      messageIds: ['m1'],
      state: 'completed',
      first: { chatId: 'chat-a', messageId: 'm1', threadId: 'thread-a' },
      channel: { sendMarkdown },
    });

    expect(persisted).toBe(false);
    expect(sendMarkdown).toHaveBeenCalledWith(
      'chat-a',
      expect.stringMatching(/终态落盘失败[\s\S]*jobs show m1/),
      { replyTo: 'm1', threadId: 'thread-a' },
    );
  });

  it.each(['completed', 'failed'] as const)(
    'notifies exactly once after a durable %s terminal snapshot',
    async (state) => {
      const finish = vi.fn().mockResolvedValue(undefined);
      const notify = vi.fn().mockResolvedValue(true);

      await expect(persistJobTerminalAndNotify({
        jobs: { finish },
        messageIds: ['m1', 'm2'],
        state,
        first: { chatId: 'chat-a', messageId: 'm1' },
        channel: { sendMarkdown: vi.fn() },
        scope: 'chat-a',
        notify,
      })).resolves.toBe(true);

      expect(finish).toHaveBeenCalledOnce();
      expect(notify).toHaveBeenCalledOnce();
      expect(notify).toHaveBeenCalledWith('chat-a', state);
      expect(finish.mock.invocationCallOrder[0]!).toBeLessThan(notify.mock.invocationCallOrder[0]!);
    },
  );

  it('does not notify when the terminal snapshot cannot be persisted', async () => {
    const notify = vi.fn().mockResolvedValue(true);

    await expect(persistJobTerminalAndNotify({
      jobs: { finish: vi.fn().mockRejectedValue(new Error('disk full')) },
      messageIds: ['m1'],
      state: 'failed',
      first: { chatId: 'chat-a', messageId: 'm1' },
      channel: { sendMarkdown: vi.fn().mockResolvedValue(undefined) },
      scope: 'chat-a',
      notify,
    })).resolves.toBe(false);

    expect(notify).not.toHaveBeenCalled();
  });
});
