import { describe, expect, it, vi } from 'vitest';
import { ReconnectNotifier } from '../../src/bridge/reconnect-notifier.js';
import { ScopeDirectory } from '../../src/bridge/scope-directory.js';

describe('ReconnectNotifier', () => {
  it('notifies only the latest destination and reports recovered duration', async () => {
    const directory = new ScopeDirectory(':memory:');
    directory.register('older', 'chat-old', undefined, 'p2p', 'old-message');
    await new Promise((resolve) => setTimeout(resolve, 2));
    directory.register('recent', 'chat-new', 'thread-1', 'topic', 'anchor-1');
    const sendMarkdown = vi.fn().mockResolvedValue(undefined);
    let now = 1_000;
    const notifier = new ReconnectNotifier(
      { sendMarkdown },
      directory,
      () => now,
      () => ({
        zhCn: '账本：queued 2 · interrupted 1',
        enUs: 'Ledger: queued 2 · interrupted 1',
      }),
    );

    await notifier.reconnecting();
    now = 4_600;
    await notifier.reconnected();

    expect(sendMarkdown).toHaveBeenNthCalledWith(
      1,
      'chat-new',
      expect.stringContaining('正在自动重连'),
      { replyTo: 'anchor-1', threadId: 'thread-1' },
    );
    expect(sendMarkdown).toHaveBeenNthCalledWith(
      2,
      'chat-new',
      expect.stringMatching(/4 秒[\s\S]*queued 2/),
      { replyTo: 'anchor-1', threadId: 'thread-1' },
    );
  });

  it('does not send a recovery notice without a reconnect episode', async () => {
    const sendMarkdown = vi.fn().mockResolvedValue(undefined);
    await new ReconnectNotifier({ sendMarkdown }, undefined).reconnected();
    expect(sendMarkdown).not.toHaveBeenCalled();
  });
});
