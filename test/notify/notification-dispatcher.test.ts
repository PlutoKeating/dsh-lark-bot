import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScopeDirectory } from '../../src/bridge/scope-directory.js';
import type { NotificationPreference, NotificationPreferenceStore } from '../../src/bot/notification-preference-store.js';
import { NotificationDispatcher } from '../../src/notify/notification-dispatcher.js';
import type { OutboundSinkRegistry } from '../../src/notify/sinks/registry.js';

afterEach(() => vi.useRealTimers());

function preference(partial: Partial<NotificationPreference>): NotificationPreference {
  return { events: [], mentionUserIds: [], approvalReminderMs: 60_000, sinks: [], ...partial };
}

describe('NotificationDispatcher', () => {
  it('routes enabled events with mentions and ignores disabled events', async () => {
    const directory = new ScopeDirectory(':memory:');
    directory.register('chat-b:thread-b', 'chat-b', 'thread-b', 'topic', 'message-b');
    const preferences = { resolve: () => preference({ target: 'chat-b:thread-b', events: ['completed', 'approval'], mentionUserIds: ['ou_a'] }) } as unknown as NotificationPreferenceStore;
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
    const preferences = { resolve: () => preference({ events: ['approval'], approvalReminderMs: 1_000 }) } as unknown as NotificationPreferenceStore;
    const send = vi.fn().mockResolvedValue(undefined);
    const dispatcher = new NotificationDispatcher({ preferences, scopeDirectory: directory, send });
    dispatcher.scheduleApprovalReminder('chat-a', 'bash');
    const cancel = dispatcher.scheduleApprovalReminder('chat-a', 'write');
    cancel();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('chat-a', expect.stringContaining('bash'), {});
  });

  it('fans out to configured sinks and does not when none are listed', async () => {
    const directory = new ScopeDirectory(':memory:');
    directory.register('chat-a', 'chat-a', undefined);
    const preferences = { resolve: () => preference({ events: ['completed'], sinks: ['tg-main'] }) } as unknown as NotificationPreferenceStore;
    const send = vi.fn().mockResolvedValue(undefined);
    const broadcast = vi.fn().mockResolvedValue({ delivered: 1, failures: [], total: 1 });
    const sinks = { broadcast, enabledChannels: () => [] } as unknown as OutboundSinkRegistry;
    const dispatcher = new NotificationDispatcher({ preferences, scopeDirectory: directory, send, sinks });
    await expect(dispatcher.notify('chat-a', 'completed')).resolves.toBe(true);
    expect(broadcast).toHaveBeenCalledWith(['tg-main'], expect.objectContaining({ event: 'completed', scope: 'chat-a' }));

    broadcast.mockClear();
    const noSinksPreferences = { resolve: () => preference({ events: ['completed'] }) } as unknown as NotificationPreferenceStore;
    const noSinksDispatcher = new NotificationDispatcher({ preferences: noSinksPreferences, scopeDirectory: directory, send, sinks });
    await expect(noSinksDispatcher.notify('chat-a', 'completed')).resolves.toBe(true);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('broadcasts urgent/fault events to every enabled sink', async () => {
    const directory = new ScopeDirectory(':memory:');
    directory.register('chat-a', 'chat-a', undefined);
    const preferences = { resolve: () => preference({}) } as unknown as NotificationPreferenceStore;
    const send = vi.fn().mockResolvedValue(undefined);
    const broadcast = vi.fn().mockResolvedValue({ delivered: 2, failures: [], total: 2 });
    const sinks = { broadcast, enabledChannels: () => [{ id: 'tg-main' }, { id: 'wecom-main' }] } as unknown as OutboundSinkRegistry;
    const dispatcher = new NotificationDispatcher({ preferences, scopeDirectory: directory, send, sinks });
    await dispatcher.notifyUrgent('chat-a', { zh: '🔴 连接异常', en: '🔴 Connection fault' });
    expect(broadcast).toHaveBeenCalledWith(['tg-main', 'wecom-main'], expect.objectContaining({ event: 'urgent', scope: 'chat-a', title: { zh: '🔴 连接异常', en: '🔴 Connection fault' } }));
  });
});
