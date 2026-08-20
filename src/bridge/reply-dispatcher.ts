import type { ReplyPolicyStore } from '../bot/reply-policy-store.js';
import { bilingualMarkdown } from '../card/i18n.js';
import type { SendOptions } from './send-options.js';

interface PendingReply {
  chatId: string;
  markdown: string;
  options?: SendOptions;
  resolve: () => void;
  reject: (error: unknown) => void;
}

/** Per-scope final-answer batching and rate limiting. */
export class ReplyDispatcher {
  private readonly queues = new Map<string, PendingReply[]>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly sending = new Set<string>();
  private readonly lastSentAt = new Map<string, number>();

  constructor(private readonly deps: {
    policies: Pick<ReplyPolicyStore, 'get'>;
    send(chatId: string, markdown: string, options?: SendOptions): Promise<void>;
    now?: () => number;
  }) {}

  deliver(scope: string, chatId: string, markdown: string, options?: SendOptions): Promise<void> {
    const policy = this.deps.policies.get(scope);
    if (policy.mergeWindowMs === 0 && policy.minIntervalMs === 0 && policy.maxBatchSize === 1) {
      return this.deps.send(chatId, markdown, options);
    }
    return new Promise<void>((resolve, reject) => {
      const queue = this.queues.get(scope) ?? [];
      queue.push({ chatId, markdown, ...(options ? { options } : {}), resolve, reject });
      this.queues.set(scope, queue);
      this.schedule(scope, policy.mergeWindowMs);
    });
  }

  private schedule(scope: string, baseDelay: number): void {
    if (this.timers.has(scope) || this.sending.has(scope) || (this.queues.get(scope)?.length ?? 0) === 0) return;
    const policy = this.deps.policies.get(scope);
    const now = (this.deps.now ?? Date.now)();
    const intervalDelay = Math.max(0, (this.lastSentAt.get(scope) ?? 0) + policy.minIntervalMs - now);
    const timer = setTimeout(() => {
      this.timers.delete(scope);
      void this.flush(scope);
    }, Math.max(baseDelay, intervalDelay));
    timer.unref?.();
    this.timers.set(scope, timer);
  }

  private async flush(scope: string): Promise<void> {
    if (this.sending.has(scope)) return;
    const queue = this.queues.get(scope);
    if (!queue?.length) return;
    const policy = this.deps.policies.get(scope);
    const firstRoute = replyRoute(queue[0]!);
    let batchSize = 0;
    while (
      batchSize < queue.length &&
      batchSize < policy.maxBatchSize &&
      replyRoute(queue[batchSize]!) === firstRoute
    ) batchSize += 1;
    const batch = queue.splice(0, batchSize);
    if (queue.length === 0) this.queues.delete(scope);
    this.sending.add(scope);
    const first = batch[0]!;
    try {
      await this.deps.send(first.chatId, mergedMarkdown(batch), mergedOptions(batch));
      this.lastSentAt.set(scope, (this.deps.now ?? Date.now)());
      for (const item of batch) item.resolve();
    } catch (error) {
      for (const item of batch) item.reject(error);
    } finally {
      this.sending.delete(scope);
      this.schedule(scope, 0);
    }
  }
}

function replyRoute(reply: PendingReply): string {
  return `${reply.chatId}\u0000${reply.options?.threadId ?? ''}`;
}

function mergedMarkdown(batch: PendingReply[]): string {
  if (batch.length === 1) return batch[0]!.markdown;
  const header = bilingualMarkdown(
    `📚 **${String(batch.length)} 个任务已完成，合并回复如下**`,
    `📚 **${String(batch.length)} tasks completed; replies are grouped below**`,
  );
  return [header, ...batch.map((item, index) => {
    const messageId = item.options?.replyTo ?? `#${String(index + 1)}`;
    return `### ${String(index + 1)} · \`${messageId}\`\n${item.markdown}`;
  })].join('\n\n---\n\n');
}

function mergedOptions(batch: PendingReply[]): SendOptions | undefined {
  const first = batch[0];
  if (!first) return undefined;
  if (batch.length === 1) return first.options;
  const threadId = first.options?.threadId;
  return threadId ? { threadId } : undefined;
}
