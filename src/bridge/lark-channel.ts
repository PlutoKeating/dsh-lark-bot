import type {
  CardStreamController as LarkCardStreamController,
  LarkChannel,
  MentionInfo,
  SendOptions,
} from '@larksuite/channel';
import { createHash } from 'node:crypto';
import type { CommandChannel } from '../commands/index.js';
import type { StreamingChannel } from './types.js';
import type { MentionTarget, SendOptions as BridgeSendOptions } from './send-options.js';

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
      await channel.stream(
        chatId,
        {
          card: {
            initial,
            producer: async (controller: LarkCardStreamController) => {
              await producer(controller);
            },
          },
        },
        toLarkSendOptions(options),
      );
    },
  };
}
