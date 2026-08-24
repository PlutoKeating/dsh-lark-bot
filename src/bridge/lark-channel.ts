import type {
  LarkChannel,
  MentionInfo,
  SendOptions,
} from '@larksuite/channel';
import { createHash } from 'node:crypto';
import type { CommandChannel } from '../commands/index.js';
import type { StreamingChannel } from './types.js';
import type { MentionTarget, SendOptions as BridgeSendOptions } from './send-options.js';
import { log } from '../core/logger.js';

const CARD_STREAM_THROTTLE_MS = 100;
const CARD_PATCH_ATTEMPTS = 2;
const MAX_CARD_WITHDRAW_RECOVERIES = 3;

/**
 * Feishu signals that the target message no longer exists (it was recalled,
 * replaced, or evicted) by returning HTTP 400 with error code `230011` and a
 * message of "The message was withdrawn". This is an ordinary, recoverable
 * condition — not a card failure — so the streaming controller must re-create
 * the card rather than treat it like a transient network error. The classifier
 * walks the thrown error object (which may be an Axios-style error with
 * `response.data` as an object or array, or the raw `[rawError, {code,msg}]`
 * tuple the SDK surfaces) and looks for `code 230011` or a "withdrawn" message.
 */
function isMessageWithdrawn(error: unknown): boolean {
  const seen = new Set<unknown>();
  const stack: unknown[] = [error];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || node === undefined) continue;
    if (typeof node === 'string') {
      if (node.toLowerCase().includes('withdrawn')) return true;
      continue;
    }
    if (typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }
    const record = node as Record<string, unknown>;
    if (record['code'] === 230011) return true;
    if (typeof record['message'] === 'string' && record['message'].toLowerCase().includes('withdrawn')) return true;
    if (typeof record['msg'] === 'string' && record['msg'].toLowerCase().includes('withdrawn')) return true;
    for (const key of ['response', 'data', 'error', 'errors']) {
      const value = record[key];
      if (value !== undefined && value !== null) stack.push(value);
    }
  }
  return false;
}

function toLarkSendOptions(options: BridgeSendOptions | undefined): SendOptions {
  const sendOptions: SendOptions = {};
  if (options?.replyTo) sendOptions.replyTo = options.replyTo;
  if (options?.threadId) {
    sendOptions.replyTo ??= options.threadId;
    sendOptions.replyInThread = true;
  }
  if (options?.mentions && options.mentions.length > 0) {
    sendOptions.mentions = options.mentions
      .map((mention: MentionTarget): MentionInfo | undefined => ({
        key: `out-${mention.userId}`,
        ...(mention.userId.startsWith('ou_') || mention.userId.startsWith('on_')
          ? { openId: mention.userId }
          : { userId: mention.userId }),
        ...(mention.name === undefined ? {} : { name: mention.name }),
      }))
      .filter((mention): mention is MentionInfo => mention !== undefined);
  }
  return sendOptions;
}

/**
 * Whole-card streaming owned by the bridge instead of the channel package.
 * The upstream timer invokes its async patch callback without observing the
 * returned promise, so a network timeout becomes an unhandled rejection and
 * can terminate the host process. This controller coalesces updates, owns the
 * in-flight promise, and degrades to a frozen process card only after genuinely
 * unrecoverable failures. When Feishu reports that the card message was
 * withdrawn (an ordinary, recoverable condition) it re-creates the card at the
 * tail from the latest snapshot and keeps streaming.
 */
class ResilientCardStreamController {
  private latest: object | undefined;
  private dirty = false;
  private failed = false;
  private closed = false;
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | undefined;
  private reanchorInFlight: Promise<string> | undefined;
  private recoveries = 0;

  constructor(
    private readonly channel: LarkChannel,
    private messageId: string,
    private readonly chatId: string,
    private readonly sendOptions: SendOptions,
  ) {}

  async update(card: object): Promise<void> {
    if (this.closed || this.failed) return;
    this.latest = card;
    this.dirty = true;
    this.schedule();
  }

  async finish(): Promise<void> {
    this.closed = true;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.inFlight !== undefined) await this.inFlight;
    if (this.reanchorInFlight !== undefined) await this.reanchorInFlight;
    if (!this.failed && this.dirty) await this.flush();
  }

  private schedule(): void {
    if (
      this.timer !== undefined ||
      this.inFlight !== undefined ||
      this.reanchorInFlight !== undefined ||
      this.failed
    ) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.startFlush();
    }, CARD_STREAM_THROTTLE_MS);
    this.timer.unref();
  }

  private startFlush(): void {
    const task = this.flush();
    this.inFlight = task;
    void task
      .finally(() => {
        if (this.inFlight === task) this.inFlight = undefined;
        if (!this.closed && this.dirty && !this.failed) this.schedule();
      })
      .catch((error: unknown) => {
        this.failed = true;
        this.dirty = false;
        log.warn('lark-card-stream', 'flush-failed', {
          messageId: this.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  private async flush(): Promise<void> {
    if (this.failed || !this.dirty || this.latest === undefined) return;
    const snapshot = this.latest;
    this.dirty = false;
    let lastError: unknown;
    for (let attempt = 1; attempt <= CARD_PATCH_ATTEMPTS; attempt += 1) {
      try {
        await this.channel.updateCard(this.messageId, snapshot);
        // A successful patch proves the card is healthy again.
        this.recoveries = 0;
        return;
      } catch (error) {
        lastError = error;
        log.warn('lark-card-stream', 'patch-attempt-failed', {
          messageId: this.messageId,
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });
        // Feishu reports the card message was withdrawn — an ordinary,
        // recoverable condition. Re-create the card at the tail and keep
        // streaming, up to a bounded budget, so a hostile loop cannot spawn
        // cards forever.
        if (
          isMessageWithdrawn(error) &&
          this.recoveries < MAX_CARD_WITHDRAW_RECOVERIES
        ) {
          try {
            await this.healFromWithdrawal();
          } catch (healError) {
            log.warn('lark-card-stream', 'heal-failed', {
              messageId: this.messageId,
              error: healError instanceof Error ? healError.message : String(healError),
            });
            break;
          }
          // A fresh message id is now installed; reuse this attempt slot so the
          // patched snapshot lands on the re-created card.
          attempt -= 1;
          continue;
        }
      }
    }
    this.failed = true;
    this.dirty = false;
    log.warn('lark-card-stream', 'patch-disabled', {
      messageId: this.messageId,
      error: lastError instanceof Error ? lastError.message : String(lastError),
    });
    try {
      await this.channel.send(this.chatId, {
        markdown: '⚠️ 过程卡更新失败，任务仍在继续；最终回答将单独发送。\n\nProcess-card updates failed. The task is still running; the final answer will arrive separately.',
      }, this.sendOptions);
    } catch (error) {
      log.warn('lark-card-stream', 'fallback-notice-failed', {
        messageId: this.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Re-create the process card at the conversation tail after the target message
   * was withdrawn (Feishu `230011` / "The message was withdrawn"). The message
   * is already gone, so there is nothing to recall: we send a fresh card carrying
   * the latest snapshot and rebind the controller to its new message id. Unlike
   * `reanchor()` this must NOT `await this.inFlight`, because we are already
   * running inside the in-flight flush; the recovery budget
   * (`MAX_CARD_WITHDRAW_RECOVERIES`) is enforced by the caller so a hostile loop
   * cannot spawn cards forever.
   */
  private async healFromWithdrawal(): Promise<void> {
    const card = this.latest;
    if (card === undefined) throw new Error('Feishu card re-creation has no snapshot to send');
    this.dirty = false;
    const sent = await this.channel.send(this.chatId, { card }, {});
    if (!sent.messageId) throw new Error('Feishu card re-creation returned no message_id');
    this.messageId = sent.messageId;
    this.failed = false;
    this.recoveries += 1;
  }

  /**
   * Recall the current card and re-create it as the newest top-level message in
   * the chat, rebinding the controller to the fresh message id. Because Feishu
   * cannot reorder an existing message, this is the only way to keep an
   * in-progress process card visible at the tail while interim agent bubbles are
   * appended below. Best-effort: if the recall fails the card is left where it
   * is (no duplicate is created); if the controller is closed or failed the id
   * is left unchanged.
   */
  async reanchor(): Promise<string> {
    if (this.closed || this.failed) return this.messageId;
    if (this.reanchorInFlight !== undefined) return this.reanchorInFlight;
    const task = this.performReanchor();
    this.reanchorInFlight = task;
    try {
      return await task;
    } finally {
      if (this.reanchorInFlight === task) this.reanchorInFlight = undefined;
      if (!this.closed && this.dirty && !this.failed) this.schedule();
    }
  }

  private async performReanchor(): Promise<string> {
    if (this.inFlight !== undefined) await this.inFlight;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    const card = this.latest;
    if (card === undefined) return this.messageId;
    // The fresh card will contain this snapshot. Updates received while recall
    // or send is in progress set dirty again and are patched only after the new
    // message id has been installed.
    this.dirty = false;
    try {
      await this.channel.recallMessage(this.messageId);
    } catch (error) {
      this.dirty = true;
      log.warn('lark-card-stream', 'reanchor-recall-failed', {
        messageId: this.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      return this.messageId;
    }
    // Re-create as a top-level message (no replyTo) so it lands at the very
    // bottom of the conversation rather than remaining attached to the parent.
    const sent = await this.channel.send(this.chatId, { card }, {});
    if (!sent.messageId) throw new Error('Feishu card re-anchor returned no message_id');
    this.messageId = sent.messageId;
    this.failed = false;
    return this.messageId;
  }
}

export function adaptLarkChannel(channel: LarkChannel): StreamingChannel {
  const base: CommandChannel = {
    async sendMarkdown(chatId, markdown, options) {
      await channel.send(chatId, { markdown }, toLarkSendOptions(options));
    },
    async updateCard(messageId, card) {
      await channel.updateCard(messageId, card);
    },
    async sendFile(chatId, fileName, content, options) {
      await channel.send(
        chatId,
        { file: { source: content, fileName } },
        toLarkSendOptions(options),
      );
    },
  };

  return {
    ...base,
    async sendCard(chatId, card, options) {
      if (options?.idempotencyKey) {
        const uuid = createHash('sha256').update(options.idempotencyKey).digest('hex').slice(0, 50);
        const payload = {
          content: JSON.stringify(card),
          msg_type: 'interactive',
          uuid,
        };
        const replyTarget = options.replyTo ?? options.threadId;
        if (replyTarget) {
          const response = await channel.rawClient.im.v1.message.reply({
            path: { message_id: replyTarget },
            data: { ...payload, reply_in_thread: options.threadId !== undefined },
          });
          if (response.code !== undefined && response.code !== 0) {
            throw new Error(`Feishu idempotent card reply failed (${String(response.code)}): ${response.msg ?? 'unknown error'}`);
          }
          const messageId = response.data?.message_id;
          if (!messageId) throw new Error('Feishu idempotent card reply returned no message_id');
          return messageId;
        }
        const response = await channel.rawClient.im.v1.message.create({
          params: { receive_id_type: 'chat_id' },
          data: {
            receive_id: chatId,
            ...payload,
          },
        });
        if (response.code !== undefined && response.code !== 0) {
          throw new Error(`Feishu idempotent card create failed (${String(response.code)}): ${response.msg ?? 'unknown error'}`);
        }
        const messageId = response.data?.message_id;
        if (!messageId) throw new Error('Feishu idempotent card create returned no message_id');
        return messageId;
      }
      const result = await channel.send(chatId, { card }, toLarkSendOptions(options));
      return result.messageId;
    },
    async recallMessage(messageId) {
      await channel.recallMessage(messageId);
    },
    async createChat(opts) {
      return channel.createChat(opts);
    },
    async streamCard(chatId, initial, producer, options) {
      const sent = await channel.send(
        chatId,
        { card: initial },
        toLarkSendOptions(options),
      );
      if (!sent.messageId) throw new Error('Feishu streaming card returned no message_id');
      const sendOptions = toLarkSendOptions(options);
      const controller = new ResilientCardStreamController(
        channel,
        sent.messageId,
        chatId,
        sendOptions,
      );
      try {
        await producer(controller);
      } finally {
        await controller.finish();
      }
    },
  };
}
