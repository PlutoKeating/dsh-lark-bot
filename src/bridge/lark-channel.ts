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
 * in-flight promise, and degrades to a frozen process card after one failure.
 */
class ResilientCardStreamController {
  private latest: object | undefined;
  private dirty = false;
  private failed = false;
  private closed = false;
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | undefined;
  private reanchorInFlight: Promise<string> | undefined;

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
        return;
      } catch (error) {
        lastError = error;
        log.warn('lark-card-stream', 'patch-attempt-failed', {
          messageId: this.messageId,
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });
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
