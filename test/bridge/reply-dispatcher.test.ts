import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReplyDispatcher } from '../../src/bridge/reply-dispatcher.js';

afterEach(() => vi.useRealTimers());

describe('ReplyDispatcher', () => {
  it('keeps compatibility mode immediate with the original reply anchor', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const dispatcher = new ReplyDispatcher({
      policies: { get: () => ({ mergeWindowMs: 0, maxBatchSize: 1, minIntervalMs: 0, dedupeWindowMs: 0 }) },
      send,
    });
    await dispatcher.deliver('chat-a', 'chat-a', 'answer', { replyTo: 'm1' });
    expect(send).toHaveBeenCalledWith('chat-a', 'answer', { replyTo: 'm1' });
  });

  it('merges a bounded batch and keeps overflow queued for the next interval', async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockResolvedValue(undefined);
    const dispatcher = new ReplyDispatcher({
      policies: { get: () => ({ mergeWindowMs: 1_000, maxBatchSize: 2, minIntervalMs: 5_000, dedupeWindowMs: 0 }) },
      send,
    });
    const deliveries = [
      dispatcher.deliver('chat-a', 'chat-a', 'answer one', { replyTo: 'm1', threadId: 't1' }),
      dispatcher.deliver('chat-a', 'chat-a', 'answer two', { replyTo: 'm2', threadId: 't1' }),
      dispatcher.deliver('chat-a', 'chat-a', 'answer three', { replyTo: 'm3', threadId: 't1' }),
    ];
    await vi.advanceTimersByTimeAsync(1_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[1]).toMatch(/2 个任务已完成[\s\S]*m1[\s\S]*answer one[\s\S]*m2[\s\S]*answer two/);
    expect(send.mock.calls[0]?.[2]).toEqual({ threadId: 't1' });
    await expect(Promise.race([deliveries[2], Promise.resolve('pending')])).resolves.toBe('pending');
    await vi.advanceTimersByTimeAsync(5_000);
    await Promise.all(deliveries);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[1]).toBe('answer three');
    expect(send.mock.calls[1]?.[2]).toEqual({ replyTo: 'm3', threadId: 't1' });
  });

  it('rejects only the affected batch when delivery fails', async () => {
    vi.useFakeTimers();
    const dispatcher = new ReplyDispatcher({
      policies: { get: () => ({ mergeWindowMs: 10, maxBatchSize: 2, minIntervalMs: 0, dedupeWindowMs: 0 }) },
      send: vi.fn().mockRejectedValue(new Error('offline')),
    });
    const delivery = dispatcher.deliver('chat-a', 'chat-a', 'answer', { replyTo: 'm1' });
    const rejected = expect(delivery).rejects.toThrow('offline');
    await vi.advanceTimersByTimeAsync(10);
    await rejected;
  });

  it('never merges replies from different threads in a shared scope', async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockResolvedValue(undefined);
    const dispatcher = new ReplyDispatcher({
      policies: { get: () => ({ mergeWindowMs: 10, maxBatchSize: 3, minIntervalMs: 20, dedupeWindowMs: 0 }) },
      send,
    });
    const first = dispatcher.deliver('chat-a', 'chat-a', 'thread one', { replyTo: 'm1', threadId: 't1' });
    const second = dispatcher.deliver('chat-a', 'chat-a', 'thread two', { replyTo: 'm2', threadId: 't2' });
    await vi.advanceTimersByTimeAsync(10);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith('chat-a', 'thread one', { replyTo: 'm1', threadId: 't1' });
    await vi.advanceTimersByTimeAsync(20);
    await Promise.all([first, second]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith('chat-a', 'thread two', { replyTo: 'm2', threadId: 't2' });
  });
});
