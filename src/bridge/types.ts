import type { CommandChannel } from '../commands/index.js';
import type { SendOptions } from './send-options.js';
export type { MentionTarget, SendOptions } from './send-options.js';

export interface CardStreamController {
  update(card: object): Promise<void>;
}

export interface StreamingChannel extends CommandChannel {
  sendCard?(chatId: string, card: object, options?: SendOptions): Promise<string | undefined>;
  recallMessage?(messageId: string): Promise<void>;
  streamCard(
    chatId: string,
    initial: object,
    producer: (controller: CardStreamController) => Promise<void>,
    options?: SendOptions,
  ): Promise<void>;
}
