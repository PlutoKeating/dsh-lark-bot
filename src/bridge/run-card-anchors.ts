import { log } from '../core/logger.js';
import type { StreamingChannel } from './types.js';

/** Re-anchor the active in-progress run card for the chat to the tail. */
export type RunCardReanchor = () => Promise<void>;

/**
 * Tracks the in-progress run cards per chat so that when any new user-facing
 * bubble is delivered to that chat (an interim agent message such as
 * `lark_notify`, or a question / plan / approval card), the running process
 * card can be re-anchored to the bottom of the conversation.
 *
 * Feishu cannot reorder an existing message, so the only way to keep the
 * process card visible at the tail is to recall it and re-create a fresh card
 * at the latest position. This registry is the coordination seam between the
 * run card (registered by `run-flow`) and the outbound send path (wired by
 * `attachRunCardAnchors`), which are otherwise separate concerns.
 */
export class RunCardAnchors {
  private readonly byChatId = new Map<string, Set<RunCardReanchor>>();

  /**
   * Register a re-anchor callback for a chat. Returns a disposer; safe to call
   * more than once (idempotent).
   */
  register(chatId: string, reanchor: RunCardReanchor): () => void {
    const set = this.byChatId.get(chatId) ?? new Set<RunCardReanchor>();
    set.add(reanchor);
    this.byChatId.set(chatId, set);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      set.delete(reanchor);
      if (set.size === 0) this.byChatId.delete(chatId);
    };
  }

  /** Notify that a new bubble was delivered to the chat. */
  async bubbleSent(chatId: string): Promise<void> {
    const set = this.byChatId.get(chatId);
    if (!set || set.size === 0) return;
    await Promise.allSettled([...set].map((reanchor) => reanchor()));
  }
}

/**
 * Wrap a streaming channel so that after a successful markdown / card / file
 * send the run-card anchors for that chat are notified, letting an in-progress
 * process card follow the tail of the conversation.
 *
 * Only runs an in-flight re-anchor for chats that actually have a registered
 * active run card; any other message is a no-op. The card's own update/re-anchor
 * operations go through `updateCard` / the raw channel `send`, so they never
 * re-enter this wrapper (no self-triggering loop).
 */
export function attachRunCardAnchors(
  channel: StreamingChannel,
  anchors: RunCardAnchors,
): StreamingChannel {
  const notify = (chatId: string): void => {
    void anchors.bubbleSent(chatId).catch((error) => {
      log.warn('run-card-anchors', 'bubble-sent-failed', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };
  return {
    ...channel,
    async sendMarkdown(chatId, markdown, options) {
      const result = await channel.sendMarkdown(chatId, markdown, options);
      notify(chatId);
      return result;
    },
    async sendCard(chatId, card, options) {
      if (typeof channel.sendCard !== 'function') return undefined;
      const result = await channel.sendCard(chatId, card, options);
      notify(chatId);
      return result;
    },
    async sendFile(chatId, fileName, content, options) {
      if (typeof channel.sendFile !== 'function') return undefined;
      const result = await channel.sendFile(chatId, fileName, content, options);
      notify(chatId);
      return result;
    },
  };
}
