import type { CommandChannel } from '../commands/index.js';
import type { SendOptions } from './send-options.js';
export type { MentionTarget, SendOptions } from './send-options.js';

export interface CardStreamController {
  update(card: object): Promise<void>;
  /**
   * Recall the current process card and re-create it as the newest message in
   * the chat, rebinding the controller to that new message id. Returns the new
   * message id, or the unchanged one when re-anchoring is not possible (closed,
   * failed, or the recall failed). Used to keep an in-progress card following
   * the tail of the conversation so the user does not have to scroll up.
   */
  reanchor?(): Promise<string>;
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
