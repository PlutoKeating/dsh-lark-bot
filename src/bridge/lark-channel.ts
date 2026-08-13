import type {
  CardStreamController as LarkCardStreamController,
  LarkChannel,
  SendOptions,
} from '@larksuite/channel';
import type { CommandChannel } from '../commands/index.js';
import type { StreamingChannel } from './types.js';

export function adaptLarkChannel(channel: LarkChannel): StreamingChannel {
  const base: CommandChannel = {
    async sendMarkdown(chatId, markdown, options) {
      const sendOptions: SendOptions = {};
      if (options?.replyTo) sendOptions.replyTo = options.replyTo;
      await channel.send(chatId, { markdown }, sendOptions);
    },
  };

  return {
    ...base,
    async streamCard(chatId, initial, producer, options) {
      const sendOptions: SendOptions = {};
      if (options?.replyTo) sendOptions.replyTo = options.replyTo;
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
        sendOptions,
      );
    },
  };
}
