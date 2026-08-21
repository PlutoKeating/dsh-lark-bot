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

  constructor(
    private readonly channel: LarkChannel,
    private readonly messageId: string,
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
    if (!this.failed && this.dirty) await this.flush();
  }

  private schedule(): void {
    if (this.timer !== undefined || this.inFlight !== undefined || this.failed) return;
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
    try {
      await this.channel.updateCard(this.messageId, snapshot);
    } catch (error) {
      this.failed = true;
      this.dirty = false;
      log.warn('lark-card-stream', 'patch-disabled', {
        messageId: this.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
      const controller = new ResilientCardStreamController(channel, sent.messageId);
      try {
        await producer(controller);
      } finally {
        await controller.finish();
      }
    },
  };
}
