import type {
  CardStreamController as LarkCardStreamController,
  LarkChannel,
  MentionInfo,
  SendOptions,
} from '@larksuite/channel';
import type { CommandChannel } from '../commands/index.js';
import type { StreamingChannel } from './types.js';
import type { MentionTarget, SendOptions as BridgeSendOptions } from './send-options.js';

function toLarkSendOptions(options: BridgeSendOptions | undefined): SendOptions {
  const sendOptions: SendOptions = {};
  if (options?.replyTo) sendOptions.replyTo = options.replyTo;
  if (options?.threadId) sendOptions.replyInThread = true;
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
  };

  return {
    ...base,
    async sendCard(chatId, card, options) {
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
