import type { JobLedger, JobRecord } from '../bot/job-ledger.js';
import type { PendingQueue } from '../bot/pending-queue.js';
import { bilingualMarkdown } from '../card/i18n.js';
import { redactSecrets, truncateUtf8Safe } from '../config/security.js';
import { log } from '../core/logger.js';
import { queuedMessageFromDurable, type QueuedMessage } from './channel.js';
import type { StreamingChannel } from './types.js';
import type { JobState } from '../bot/job-ledger.js';

export interface JobRecoverySummary {
  queued: number;
  interrupted: number;
}

export interface JobRecoveryPlan {
  queued: JobRecord[];
  running: JobRecord[];
  interrupted: JobRecord[];
}

/** Freeze the recovery set before the live channel can accept new events. */
export async function prepareDurableJobRecovery(jobs: JobLedger): Promise<JobRecoveryPlan> {
  return {
    queued: jobs.queued(),
    running: jobs.running(),
    interrupted: jobs.pendingRecoveryNotices(),
  };
}

/**
 * Reconciles durable jobs only after the outbound channel is ready. Queued
 * messages are safe to replay; in-flight jobs become explicit interrupted
 * records and require a human retry because tools may already have had side
 * effects before the previous process stopped.
 */
export async function recoverDurableJobs(
  plan: JobRecoveryPlan,
  jobs: Pick<JobLedger, 'recoverInterrupted' | 'markRecoveryNotified'>,
  pending: Pick<PendingQueue<QueuedMessage>, 'push'>,
  channel: Pick<StreamingChannel, 'sendMarkdown'>,
): Promise<JobRecoverySummary> {
  for (const record of plan.queued) {
    await channel.sendMarkdown(
      record.message.chatId,
      bilingualMarkdown(
        `♻️ 已从持久任务账本恢复排队消息：\`${record.message.messageId}\`，即将继续处理。`,
        `♻️ Restored queued message \`${record.message.messageId}\` from the durable job ledger; processing will resume shortly.`,
      ),
      routeFor(record.message),
    ).catch((error) => log.fail('job-ledger', error, {
      step: 'queued-recovery-notice',
      messageId: record.message.messageId,
    }));
    pending.push(record.message.scope, queuedMessageFromDurable(record.message));
  }

  // Convert only the pre-connect running snapshot after outbound delivery is
  // ready. A crash before this point leaves it running so the next boot can
  // retry reconciliation. The pending bit makes notification at-least-once.
  const newlyInterrupted = await jobs.recoverInterrupted(
    plan.running.map((record) => record.message.messageId),
  );
  const interrupted = new Map<string, JobRecord>();
  for (const record of [...plan.interrupted, ...newlyInterrupted]) {
    interrupted.set(record.message.messageId, record);
  }
  for (const record of interrupted.values()) {
    const checkpoint = safeInline(record.checkpoint?.detail ?? record.checkpoint?.stage ?? 'unknown');
    try {
      await channel.sendMarkdown(
        record.message.chatId,
        bilingualMarkdown(
          `⚠️ 上次任务在 bridge 退出时中断：\`${record.message.messageId}\`（最后 checkpoint：${checkpoint}）。为避免重复外部副作用，未自动重跑；可用 \`/jobs show ${record.message.messageId}\` 对账，确认后执行 \`/jobs retry ${record.message.messageId}\`。`,
          `⚠️ The previous job was interrupted when the bridge stopped: \`${record.message.messageId}\` (last checkpoint: ${checkpoint}). It was not rerun automatically to avoid duplicate external side effects. Use \`/jobs show ${record.message.messageId}\`, then \`/jobs retry ${record.message.messageId}\` after review.`,
        ),
        routeFor(record.message),
      );
      await jobs.markRecoveryNotified(record.message.messageId);
    } catch (error) {
      log.fail('job-ledger', error, {
        step: 'recovery-notice',
        messageId: record.message.messageId,
      });
    }
  }

  return { queued: plan.queued.length, interrupted: interrupted.size };
}

export async function persistDispatchFailure(input: {
  jobs: Pick<JobLedger, 'finish'>;
  messageIds: string[];
  error: string;
  first: Pick<QueuedMessage, 'chatId' | 'messageId' | 'threadId'>;
  channel: Pick<StreamingChannel, 'sendMarkdown'>;
}): Promise<'failed' | 'queued'> {
  try {
    await input.jobs.finish(input.messageIds, 'failed', `dispatch receipt failed: ${input.error}`);
    await input.channel.sendMarkdown(
      input.first.chatId,
      bilingualMarkdown(
        `⚠️ 任务尚未执行：running receipt 落盘失败，账本已将其标为 failed。请检查本机存储后，用 \`/jobs retry ${input.first.messageId}\` 明确重试。`,
        `⚠️ The job was not executed because its running receipt could not be persisted. It is marked failed; check local storage, then explicitly retry with \`/jobs retry ${input.first.messageId}\`.`,
      ),
      routeFor(input.first),
    ).catch((noticeError) => log.fail('job-ledger', noticeError, {
      step: 'dispatch-failure-notice',
      messageId: input.first.messageId,
    }));
    return 'failed';
  } catch (persistError) {
    log.fail('job-ledger', persistError, {
      step: 'dispatch-failure-persist',
      messageIds: input.messageIds,
    });
    await input.channel.sendMarkdown(
      input.first.chatId,
      bilingualMarkdown(
        `⚠️ 任务尚未执行，且账本无法写入 running/failed 状态；原 durable receipt 仍为 queued。请先修复本机存储并重启 bridge，启动恢复会安全重放该消息。不要重复发送原消息。`,
        `⚠️ The job was not executed, and neither its running nor failed state could be persisted. Its durable receipt remains queued. Fix local storage and restart the bridge so startup recovery can safely replay it; do not resend the original message.`,
      ),
      routeFor(input.first),
    ).catch((noticeError) => log.fail('job-ledger', noticeError, {
      step: 'dispatch-queued-notice',
      messageId: input.first.messageId,
    }));
    return 'queued';
  }
}

export async function claimJobDispatch(input: {
  jobs: Pick<JobLedger, 'markRunning' | 'finish'>;
  messageIds: string[];
  runId: string;
  first: Pick<QueuedMessage, 'chatId' | 'messageId' | 'threadId'>;
  channel: Pick<StreamingChannel, 'sendMarkdown'>;
}): Promise<boolean> {
  try {
    await input.jobs.markRunning(input.messageIds, input.runId);
    return true;
  } catch (error) {
    await persistDispatchFailure({
      jobs: input.jobs,
      messageIds: input.messageIds,
      error: error instanceof Error ? error.message : String(error),
      first: input.first,
      channel: input.channel,
    });
    return false;
  }
}

export async function persistJobTerminal(input: {
  jobs: Pick<JobLedger, 'finish'>;
  messageIds: string[];
  state: Extract<JobState, 'completed' | 'failed' | 'interrupted'>;
  error?: string;
  first: Pick<QueuedMessage, 'chatId' | 'messageId' | 'threadId'>;
  channel: Pick<StreamingChannel, 'sendMarkdown'>;
}): Promise<boolean> {
  if (input.messageIds.length === 0) return true;
  try {
    await input.jobs.finish(input.messageIds, input.state, input.error);
    return true;
  } catch (error) {
    log.fail('job-ledger', error, {
      step: 'terminal-persist',
      messageIds: input.messageIds,
    });
    await input.channel.sendMarkdown(
      input.first.chatId,
      bilingualMarkdown(
        `⚠️ 任务已经结束，但任务账本终态落盘失败；当前记录可能仍显示 running。请保留消息 ID \`${input.first.messageId}\` 并用 \`/jobs show ${input.first.messageId}\` 对账；若 bridge 重启，它会安全标记为 interrupted，不会自动重复执行。`,
        `⚠️ The job ended, but its terminal ledger update could not be persisted, so it may still appear as running. Keep message ID \`${input.first.messageId}\` and reconcile with \`/jobs show ${input.first.messageId}\`. After a bridge restart it will be marked interrupted and will not rerun automatically.`,
      ),
      routeFor(input.first),
    ).catch((noticeError) => log.fail('job-ledger', noticeError, {
      step: 'terminal-persist-notice',
      messageId: input.first.messageId,
    }));
    return false;
  }
}

function safeInline(value: string): string {
  return truncateUtf8Safe(redactSecrets(value), 240)
    .replaceAll('`', '\\`')
    .replaceAll(/\s+/gu, ' ');
}

function routeFor(message: { messageId: string; threadId?: string }): {
  replyTo: string;
  threadId?: string;
} {
  return {
    replyTo: message.messageId,
    ...(message.threadId ? { threadId: message.threadId } : {}),
  };
}
