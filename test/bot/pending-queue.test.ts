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

  it('runs up to the per-scope concurrency limit in parallel', async () => {
    vi.useFakeTimers();
    let inFlight = 0;
    let maxInFlight = 0;
    let releaseA: (() => void) | undefined;
    let releaseB: (() => void) | undefined;
    const onFlush = vi.fn(async (_scope: string, _batch: string[]) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve) => {
        if (onFlush.mock.calls.length === 1) releaseA = resolve;
        else releaseB = resolve;
      });
      inFlight -= 1;
    });
    const queue = new PendingQueue(600, onFlush, () => 2);

    queue.push('chat-a', 'one');
    await vi.advanceTimersByTimeAsync(600);
    queue.push('chat-a', 'two');
    await vi.advanceTimersByTimeAsync(600);

    expect(onFlush).toHaveBeenCalledTimes(2);
    expect(maxInFlight).toBe(2);
    releaseA?.();
    releaseB?.();
    await vi.advanceTimersByTimeAsync(0);
  });

  it('does not exceed the concurrency limit even with many queued batches', async () => {
    vi.useFakeTimers();
    let inFlight = 0;
    let maxInFlight = 0;
    const releases: Array<() => void> = [];
    const onFlush = vi.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve) => releases.push(resolve));
      inFlight -= 1;
    });
    const queue = new PendingQueue(1, onFlush, () => 2);

    queue.push('chat-a', 'a');
    await vi.advanceTimersByTimeAsync(1);
    queue.push('chat-a', 'b');
    await vi.advanceTimersByTimeAsync(1);
    queue.push('chat-a', 'c');
    await vi.advanceTimersByTimeAsync(1);

    expect(onFlush).toHaveBeenCalledTimes(2);
    expect(maxInFlight).toBe(2);
    expect(queue.activeFlushes('chat-a')).toBe(2);
    expect(queue.isFlushing('chat-a')).toBe(true);

    releases.shift()?.();
    await vi.advanceTimersByTimeAsync(1);
    expect(onFlush).toHaveBeenCalledTimes(3);
    releases.forEach((release) => release());
    await vi.advanceTimersByTimeAsync(0);
  });
});
