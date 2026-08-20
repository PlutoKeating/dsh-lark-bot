import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScopeDirectory } from '../../src/bridge/scope-directory.js';
import type { NotificationPreferenceStore } from '../../src/bot/notification-preference-store.js';
import { NotificationDispatcher } from '../../src/notify/notification-dispatcher.js';

afterEach(() => vi.useRealTimers());

describe('NotificationDispatcher', () => {
  it('routes enabled events with mentions and ignores disabled events', async () => {
    const directory = new ScopeDirectory(':memory:');
    directory.register('chat-b:thread-b', 'chat-b', 'thread-b', 'topic', 'message-b');
    const preferences = { resolve: () => ({ target: 'chat-b:thread-b', events: ['completed', 'approval'], mentionUserIds: ['ou_a'], approvalReminderMs: 60_000 }) } as unknown as NotificationPreferenceStore;
    const send = vi.fn().mockResolvedValue(undefined);
    const dispatcher = new NotificationDispatcher({ preferences, scopeDirectory: directory, send });
    await expect(dispatcher.notify('chat-a', 'failed')).resolves.toBe(false);
    await expect(dispatcher.notify('chat-a', 'completed')).resolves.toBe(true);
    expect(send).toHaveBeenCalledWith('chat-b', expect.stringContaining('任务已完成'), { threadId: 'thread-b', replyTo: 'message-b', mentions: [{ userId: 'ou_a' }] });
  });

  it('sends one delayed approval reminder and cancellation clears it', async () => {
    vi.useFakeTimers();
    const directory = new ScopeDirectory(':memory:');
    directory.register('chat-a', 'chat-a', undefined);
    const preferences = { resolve: () => ({ events: ['approval'], mentionUserIds: [], approvalReminderMs: 1_000 }) } as unknown as NotificationPreferenceStore;
    const send = vi.fn().mockResolvedValue(undefined);
    const dispatcher = new NotificationDispatcher({ preferences, scopeDirectory: directory, send });
    dispatcher.scheduleApprovalReminder('chat-a', 'bash');
    const cancel = dispatcher.scheduleApprovalReminder('chat-a', 'write');
    cancel();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('chat-a', expect.stringContaining('bash'), {});
  });
});
