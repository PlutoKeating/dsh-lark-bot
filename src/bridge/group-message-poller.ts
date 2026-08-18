import type { NormalizedMessage } from '@larksuite/channel';
import { log } from '../core/logger.js';

export interface GroupHistoryItem {
  messageId: string;
  chatId: string;
  createTime: number;
  senderId: string;
  senderType: string;
  messageType: string;
  deleted: boolean;
}

export interface GroupHistoryPage {
  items: GroupHistoryItem[];
  hasMore: boolean;
  pageToken?: string;
}

export interface GroupHistorySource {
  listMessages(input: {
    chatId: string;
    startTime: string;
    pageSize: number;
    pageToken: string | undefined;
  }): Promise<GroupHistoryPage>;
  fetchMessage(messageId: string): Promise<NormalizedMessage | undefined>;
  getChatMode?(chatId: string): Promise<'p2p' | 'group' | 'topic'>;
}

export interface KnownGroupChat {
  chatId: string;
  chatMode: 'p2p' | 'group' | 'topic' | undefined;
}

export interface GroupPollingAccess {
  allowedUsers: string[];
  allowedChats: string[];
}

export interface GroupMessagePollerOptions {
  pollIntervalMs: number;
  freshnessMs: number;
  source: GroupHistorySource;
  knownChats(): KnownGroupChat[];
  access(): GroupPollingAccess;
  onMessage(message: NormalizedMessage): Promise<void>;
  now?: () => number;
}

/**
 * Supplements PersonalAgent's mention-only group events with incremental
 * reads from Feishu's chat-history API. The public seam is deliberately
 * transport-agnostic so pagination, filtering, and deduplication stay
 * deterministic in tests.
 */
export class GroupMessagePoller {
  private readonly now: () => number;
  private readonly startedAt: number;
  private readonly seen = new Set<string>();
  private readonly watermarks = new Map<string, { createTime: number; messageId: string }>();
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | undefined;

  constructor(private readonly options: GroupMessagePollerOptions) {
    this.now = options.now ?? Date.now;
    this.startedAt = this.now();
  }

  /** Atomically claim a message id across live-event and polling paths. */
  claim(messageId: string): boolean {
    if (this.seen.has(messageId)) return false;
    this.seen.add(messageId);
    if (this.seen.size > 10_000) {
      const oldest = this.seen.values().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    return true;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.inFlight) return;
      this.inFlight = this.pollOnce()
        .catch((error: unknown) => {
          log.fail('group-poller', error);
        })
        .finally(() => {
          this.inFlight = undefined;
        });
    }, this.options.pollIntervalMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.inFlight;
  }

  async pollOnce(): Promise<void> {
    for (const chat of this.options.knownChats()) {
      try {
        const chatMode =
          chat.chatMode ?? (await this.options.source.getChatMode?.(chat.chatId));
        if (chatMode !== 'group' && chatMode !== 'topic') continue;
        await this.pollChat(chat.chatId, chatMode);
      } catch (error) {
        log.fail('group-poller', error, { chatId: chat.chatId });
      }
    }
  }

  private async pollChat(
    chatId: string,
    chatMode: 'group' | 'topic',
  ): Promise<void> {
    const watermark = this.watermarks.get(chatId) ?? {
      createTime: this.startedAt,
      messageId: '',
    };
    const startTime = String(Math.floor(watermark.createTime / 1_000));
    let pageToken: string | undefined;
    const usedTokens = new Set<string>();
    for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
      const page = await this.options.source.listMessages({
        chatId,
        startTime,
        pageSize: 50,
        pageToken,
      });
      const items = [...page.items].sort(
        (left, right) =>
          left.createTime - right.createTime || left.messageId.localeCompare(right.messageId),
      );
      for (const item of items) {
        const current = this.watermarks.get(chatId) ?? watermark;
        if (item.createTime < current.createTime || item.chatId !== chatId) continue;
        if (!this.shouldProcess(item)) {
          this.advanceWatermark(chatId, item);
          continue;
        }
        if (!this.claim(item.messageId)) {
          this.advanceWatermark(chatId, item);
          continue;
        }
        try {
          const message = await this.options.source.fetchMessage(item.messageId);
          if (message && this.shouldDeliver(message, item.chatId)) {
            await this.options.onMessage({
              ...message,
              chatMode: message.chatMode ?? chatMode,
            });
          }
          this.advanceWatermark(chatId, item);
        } catch (error) {
          this.seen.delete(item.messageId);
          throw error;
        }
      }
      if (!page.hasMore || !page.pageToken || usedTokens.has(page.pageToken)) return;
      usedTokens.add(page.pageToken);
      pageToken = page.pageToken;
    }
  }

  private advanceWatermark(chatId: string, item: GroupHistoryItem): void {
    const current = this.watermarks.get(chatId);
    if (
      !current ||
      item.createTime > current.createTime ||
      (item.createTime === current.createTime && item.messageId > current.messageId)
    ) {
      this.watermarks.set(chatId, {
        createTime: item.createTime,
        messageId: item.messageId,
      });
    }
  }

  private shouldProcess(item: GroupHistoryItem): boolean {
    if (item.createTime < this.startedAt) return false;
    if (item.deleted || item.messageType === 'system' || item.senderType !== 'user') {
      return false;
    }
    if (
      this.options.freshnessMs > 0 &&
      this.now() - item.createTime > this.options.freshnessMs
    ) {
      return false;
    }
    const access = this.options.access();
    if (!access.allowedUsers.includes(item.senderId)) return false;
    if (access.allowedChats.length > 0 && !access.allowedChats.includes(item.chatId)) {
      return false;
    }
    return true;
  }

  private shouldDeliver(message: NormalizedMessage, expectedChatId: string): boolean {
    if (message.chatId !== expectedChatId) return false;
    if (message.senderIsBot === true || message.senderType !== 'user') return false;
    if (
      this.options.freshnessMs > 0 &&
      this.now() - message.createTime > this.options.freshnessMs
    ) {
      return false;
    }
    const access = this.options.access();
    if (!access.allowedUsers.includes(message.senderId)) return false;
    if (access.allowedChats.length > 0 && !access.allowedChats.includes(message.chatId)) {
      return false;
    }
    return true;
  }
}
