import type { CommandChannel } from '../commands/index.js';

export interface CardStreamController {
  update(card: object): Promise<void>;
}

export interface StreamingChannel extends CommandChannel {
  streamCard(
    chatId: string,
    initial: object,
    producer: (controller: CardStreamController) => Promise<void>,
    options?: { replyTo?: string },
  ): Promise<void>;
}
