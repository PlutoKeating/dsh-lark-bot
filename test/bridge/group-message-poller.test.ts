import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedMessage } from '@larksuite/channel';
import { GroupMessagePoller } from '../../src/bridge/group-message-poller.js';

function normalizedMessage(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    messageId: 'om-new',
    chatId: 'oc-group',
    chatType: 'group',
    chatMode: 'group',
    senderId: 'ou-allowed',
    senderType: 'user',
    senderIsBot: false,
    content: 'plain group message',
    rawContentType: 'text',
    resources: [],
    mentions: [],
    mentionAll: false,
    mentionedBot: false,
    createTime: 10_001,
    ...overrides,
  };
}

describe('GroupMessagePoller', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('delivers a new user message from a registered group through the shared handler', async () => {
    const onMessage = vi.fn().mockResolvedValue(undefined);
    const source = {
      listMessages: vi.fn().mockResolvedValue({
        items: [
          {
            messageId: 'om-new',
            chatId: 'oc-group',
            createTime: 10_001,
            senderId: 'ou-allowed',
            senderType: 'user',
            messageType: 'text',
            deleted: false,
          },
        ],
        hasMore: false,
      }),
      fetchMessage: vi.fn().mockResolvedValue(normalizedMessage()),
    };
    const poller = new GroupMessagePoller({
      pollIntervalMs: 3_000,
      freshnessMs: 600_000,
      source,
      knownChats: () => [{ chatId: 'oc-group', chatMode: 'group' }],
      access: () => ({ allowedUsers: ['ou-allowed'], allowedChats: [] }),
      onMessage,
      now: () => 10_000,
    });

    await poller.pollOnce();

    expect(source.listMessages).toHaveBeenCalledWith({
      chatId: 'oc-group',
      startTime: '10',
      pageSize: 50,
      pageToken: undefined,
    });
    expect(source.fetchMessage).toHaveBeenCalledWith('om-new');
    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'om-new', content: 'plain group message' }),
    );
  });

  it('deduplicates a message already claimed by the live event path', async () => {
    const source = {
      listMessages: vi.fn().mockResolvedValue({
        items: [
          {
            messageId: 'om-event',
            chatId: 'oc-group',
            createTime: 10_001,
            senderId: 'ou-allowed',
            senderType: 'user',
            messageType: 'text',
            deleted: false,
          },
        ],
        hasMore: false,
      }),
      fetchMessage: vi.fn(),
    };
    const poller = new GroupMessagePoller({
      pollIntervalMs: 3_000,
      freshnessMs: 600_000,
      source,
      knownChats: () => [{ chatId: 'oc-group', chatMode: 'group' }],
      access: () => ({ allowedUsers: ['ou-allowed'], allowedChats: [] }),
      onMessage: vi.fn(),
      now: () => 10_000,
    });

    expect(poller.claim('om-event')).toBe(true);
    expect(poller.claim('om-event')).toBe(false);
    await poller.pollOnce();

    expect(source.fetchMessage).not.toHaveBeenCalled();
  });

  it('revalidates the normalized sender before delivering a polled message', async () => {
    const onMessage = vi.fn();
    const source = {
      listMessages: vi.fn().mockResolvedValue({
        items: [
          {
            messageId: 'om-spoofed',
            chatId: 'oc-group',
            createTime: 10_001,
            senderId: 'ou-allowed',
            senderType: 'user',
            messageType: 'text',
            deleted: false,
          },
        ],
        hasMore: false,
      }),
      fetchMessage: vi.fn().mockResolvedValue(
        normalizedMessage({
          messageId: 'om-spoofed',
          senderId: 'bot-open-id',
          senderType: 'bot',
          senderIsBot: true,
        }),
      ),
    };
    const poller = new GroupMessagePoller({
      pollIntervalMs: 3_000,
      freshnessMs: 600_000,
      source,
      knownChats: () => [{ chatId: 'oc-group', chatMode: 'group' }],
      access: () => ({ allowedUsers: ['ou-allowed'], allowedChats: [] }),
      onMessage,
      now: () => 10_000,
    });

    await poller.pollOnce();

    expect(onMessage).not.toHaveBeenCalled();
  });

  it('filters deleted, system, bot, and non-allowlisted history items before fetching', async () => {
    const item = (
      messageId: string,
      overrides: Partial<{
        senderId: string;
        senderType: string;
        messageType: string;
        deleted: boolean;
      }> = {},
    ) => ({
      messageId,
      chatId: 'oc-group',
      createTime: 10_001,
      senderId: 'ou-allowed',
      senderType: 'user',
      messageType: 'text',
      deleted: false,
      ...overrides,
    });
    const source = {
      listMessages: vi.fn().mockResolvedValue({
        items: [
          item('om-deleted', { deleted: true }),
          item('om-system', { messageType: 'system' }),
          item('om-bot', { senderType: 'bot' }),
          item('om-denied', { senderId: 'ou-denied' }),
          item('om-allowed'),
        ],
        hasMore: false,
      }),
      fetchMessage: vi.fn().mockResolvedValue(normalizedMessage({ messageId: 'om-allowed' })),
    };
    const onMessage = vi.fn().mockResolvedValue(undefined);
    const poller = new GroupMessagePoller({
      pollIntervalMs: 3_000,
      freshnessMs: 600_000,
      source,
      knownChats: () => [{ chatId: 'oc-group', chatMode: 'group' }],
      access: () => ({ allowedUsers: ['ou-allowed'], allowedChats: [] }),
      onMessage,
      now: () => 10_000,
    });

    await poller.pollOnce();

    expect(source.fetchMessage).toHaveBeenCalledOnce();
    expect(source.fetchMessage).toHaveBeenCalledWith('om-allowed');
    expect(onMessage).toHaveBeenCalledOnce();
  });

  it('paginates in create-time order and advances a per-chat watermark', async () => {
    const onMessage = vi.fn().mockResolvedValue(undefined);
    const item = (messageId: string, createTime: number) => ({
      messageId,
      chatId: 'oc-group',
      createTime,
      senderId: 'ou-allowed',
      senderType: 'user',
      messageType: 'text',
      deleted: false,
    });
    const source = {
      listMessages: vi
        .fn()
        .mockResolvedValueOnce({ items: [item('om-1', 11_000)], hasMore: true, pageToken: 'p2' })
        .mockResolvedValueOnce({ items: [item('om-2', 12_000)], hasMore: false })
        .mockResolvedValueOnce({
          items: [item('om-2', 12_000), item('om-3', 13_000)],
          hasMore: false,
        }),
      fetchMessage: vi.fn().mockImplementation(async (messageId: string) =>
        normalizedMessage({
          messageId,
          createTime: messageId === 'om-1' ? 11_000 : messageId === 'om-2' ? 12_000 : 13_000,
        }),
      ),
    };
    const poller = new GroupMessagePoller({
      pollIntervalMs: 3_000,
      freshnessMs: 600_000,
      source,
      knownChats: () => [{ chatId: 'oc-group', chatMode: 'group' }],
      access: () => ({ allowedUsers: ['ou-allowed'], allowedChats: [] }),
      onMessage,
      now: () => 10_000,
    });

    await poller.pollOnce();
    await poller.pollOnce();

    expect(source.listMessages).toHaveBeenNthCalledWith(2, {
      chatId: 'oc-group',
      startTime: '10',
      pageSize: 50,
      pageToken: 'p2',
    });
    expect(source.listMessages).toHaveBeenNthCalledWith(3, {
      chatId: 'oc-group',
      startTime: '12',
      pageSize: 50,
      pageToken: undefined,
    });
    expect(onMessage.mock.calls.map(([message]) => message.messageId)).toEqual([
      'om-1',
      'om-2',
      'om-3',
    ]);
  });

  it('polls on the configured interval and stops without leaving a timer active', async () => {
    vi.useFakeTimers();
    const source = {
      listMessages: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
      fetchMessage: vi.fn(),
    };
    const poller = new GroupMessagePoller({
      pollIntervalMs: 3_000,
      freshnessMs: 600_000,
      source,
      knownChats: () => [{ chatId: 'oc-group', chatMode: 'group' }],
      access: () => ({ allowedUsers: ['ou-allowed'], allowedChats: [] }),
      onMessage: vi.fn(),
      now: () => 10_000,
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(source.listMessages).toHaveBeenCalledTimes(1);

    await poller.stop();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(source.listMessages).toHaveBeenCalledTimes(1);
  });

  it('isolates a failed chat so other registered groups are still polled', async () => {
    const onMessage = vi.fn().mockResolvedValue(undefined);
    const source = {
      listMessages: vi.fn().mockImplementation(async ({ chatId }: { chatId: string }) => {
        if (chatId === 'oc-broken') throw new Error('history unavailable');
        return {
          items: [
            {
              messageId: 'om-healthy',
              chatId,
              createTime: 10_001,
              senderId: 'ou-allowed',
              senderType: 'user',
              messageType: 'text',
              deleted: false,
            },
          ],
          hasMore: false,
        };
      }),
      fetchMessage: vi.fn().mockResolvedValue(
        normalizedMessage({ messageId: 'om-healthy', chatId: 'oc-healthy' }),
      ),
    };
    const poller = new GroupMessagePoller({
      pollIntervalMs: 3_000,
      freshnessMs: 600_000,
      source,
      knownChats: () => [
        { chatId: 'oc-broken', chatMode: 'group' },
        { chatId: 'oc-healthy', chatMode: 'group' },
      ],
      access: () => ({ allowedUsers: ['ou-allowed'], allowedChats: [] }),
      onMessage,
      now: () => 10_000,
    });

    await poller.pollOnce();

    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'om-healthy', chatId: 'oc-healthy' }),
    );
  });
});
