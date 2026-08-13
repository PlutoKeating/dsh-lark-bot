import { afterEach, describe, expect, it, vi } from 'vitest';
import { PendingQueue } from '../../src/bot/pending-queue.js';

describe('PendingQueue', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('merges messages during the quiet window and flushes once', async () => {
    vi.useFakeTimers();
    const onFlush = vi.fn();
    const queue = new PendingQueue(600, onFlush);

    queue.push('chat-a', 'one');
    queue.push('chat-a', 'two');
    expect(onFlush).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(600);
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith('chat-a', ['one', 'two']);
  });

  it('holds messages while a scope is blocked and flushes after unblock', async () => {
    vi.useFakeTimers();
    const onFlush = vi.fn();
    const queue = new PendingQueue(600, onFlush);

    queue.block('chat-a');
    queue.push('chat-a', 'one');
    await vi.advanceTimersByTimeAsync(2000);
    expect(onFlush).not.toHaveBeenCalled();

    queue.unblock('chat-a');
    await vi.advanceTimersByTimeAsync(600);
    expect(onFlush).toHaveBeenCalledWith('chat-a', ['one']);
  });
});
