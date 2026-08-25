import type { ScopeDirectory } from '../bridge/scope-directory.js';
import type { SendOptions } from '../bridge/send-options.js';
import { bilingualMarkdown } from '../card/i18n.js';
import type { NotificationEvent, NotificationPreference, NotificationPreferenceStore } from '../bot/notification-preference-store.js';
import type { OutboundSinkRegistry } from './sinks/registry.js';
import { log } from '../core/logger.js';

interface BilingualTitle {
  zh: string;
  en: string;
}

export class NotificationDispatcher {
  private defaultPreference: NotificationPreference | undefined;

  constructor(private readonly deps: {
    preferences: NotificationPreferenceStore;
    defaultPreference?: NotificationPreference;
    scopeDirectory: ScopeDirectory;
    send(chatId: string, markdown: string, options?: SendOptions): Promise<void>;
    /** Optional outbound sink fan-out (issue #113). Absent = legacy behavior. */
    sinks?: OutboundSinkRegistry;
  }) {
    this.defaultPreference = clonePreference(deps.defaultPreference);
  }

  /** Update the profile fallback without interrupting active bridge runs. */
  setDefaultPreference(preference: NotificationPreference | undefined): void {
    this.defaultPreference = clonePreference(preference);
  }

  /**
   * Primary notification path: send to Feishu (default first-class route) and,
   * when the scope preference lists extra channels, fan out to those sinks.
   * Returns `false` when the event is disabled or no Feishu destination exists.
   */
  async notify(scope: string, event: NotificationEvent, detail?: string): Promise<boolean> {
    const preference = this.deps.preferences.resolve(scope, this.defaultPreference);
    if (!preference?.events.includes(event)) return false;
    const destination = preference.target
      ? this.deps.scopeDirectory.resolve(preference.target) ?? this.deps.scopeDirectory.resolveChat(preference.target)
      : this.deps.scopeDirectory.resolve(scope);
    if (!destination) {
      log.warn('notification', 'target-unavailable', { scope, target: preference.target });
      return false;
    }
    const title = titleForEvent(event);
    try {
      await this.deps.send(destination.chatId, renderFeishuBody(title, scope, detail), {
        ...(destination.threadId ? { threadId: destination.threadId } : {}),
        ...(destination.messageId ? { replyTo: destination.messageId } : {}),
        ...(preference.mentionUserIds.length > 0
          ? { mentions: preference.mentionUserIds.map((userId) => ({ userId })) }
          : {}),
      });
    } catch (error) {
      log.warn('notification', 'send-failed', { scope, event, error });
      return false;
    }
    if (preference.sinks.length > 0) {
      await this.broadcastSinks(preference.sinks, scope, event, title, detail);
    }
    return true;
  }

  /**
   * Safety-net / fault class notification (issue #113): broadcast to every
   * enabled outbound sink regardless of the per-scope opt-in, so a crash /
   * reconnect / heartbeat anomaly is seen even when a scope has not enabled
   * proactive Feishu reminders. When the scope preference explicitly enables
   * the `urgent` event it is also sent to Feishu.
   */
  async notifyUrgent(scope: string, title: BilingualTitle, detail?: string): Promise<void> {
    const channels = this.deps.sinks?.enabledChannels() ?? [];
    if (channels.length > 0) {
      await this.broadcastSinks(
        channels.map((channel) => channel.id),
        scope,
        'urgent',
        title,
        detail,
      );
    }
    const preference = this.deps.preferences.resolve(scope, this.defaultPreference);
    if (!preference?.events.includes('urgent')) return;
    const destination = preference.target
      ? this.deps.scopeDirectory.resolve(preference.target) ?? this.deps.scopeDirectory.resolveChat(preference.target)
      : this.deps.scopeDirectory.resolve(scope);
    if (!destination) return;
    try {
      await this.deps.send(destination.chatId, renderFeishuBody(title, scope, detail), {
        ...(destination.threadId ? { threadId: destination.threadId } : {}),
        ...(destination.messageId ? { replyTo: destination.messageId } : {}),
      });
    } catch (error) {
      log.warn('notification', 'urgent-send-failed', { scope, error });
    }
  }

  scheduleApprovalReminder(scope: string, toolName: string): () => void {
    const preference = this.deps.preferences.resolve(scope, this.defaultPreference);
    if (!preference?.events.includes('approval')) return () => undefined;
    const timer = setTimeout(() => { void this.notify(scope, 'approval', `tool \`${toolName}\``); }, preference.approvalReminderMs);
    timer.unref?.();
    return () => clearTimeout(timer);
  }

  private async broadcastSinks(
    channelIds: string[],
    scope: string,
    event: NotificationEvent,
    title: BilingualTitle,
    detail?: string,
  ): Promise<void> {
    if (!this.deps.sinks || channelIds.length === 0) return;
    try {
      const outcome = await this.deps.sinks.broadcast(channelIds, {
        scope,
        event,
        title,
        ...(detail === undefined ? {} : { detail }),
      });
      if (outcome.failures.length > 0) {
        log.warn('notification', 'sink-failures', { scope, event, failures: outcome.failures });
      }
    } catch (error) {
      // Fan-out must never destabilize the primary Feishu notification path.
      log.warn('notification', 'sink-broadcast-error', { scope, event, error });
    }
  }
}

function titleForEvent(event: NotificationEvent): BilingualTitle {
  switch (event) {
    case 'completed':
      return { zh: '✅ 任务已完成', en: '✅ Task completed' };
    case 'failed':
      return { zh: '⚠️ 任务执行失败', en: '⚠️ Task failed' };
    case 'approval':
      return { zh: '⏳ 任务仍在等待操作审批', en: '⏳ Task is still waiting for tool approval' };
    case 'urgent':
      return { zh: '🔴 突发 / 故障', en: '🔴 Urgent / fault' };
  }
}

function renderFeishuBody(title: BilingualTitle, scope: string, detail?: string): string {
  return bilingualMarkdown(
    `${title.zh}（scope \`${scope}\`）${detail ? `：${detail}` : ''}`,
    `${title.en} (scope \`${scope}\`)${detail ? `: ${detail}` : ''}`,
  );
}

function clonePreference(preference: NotificationPreference | undefined): NotificationPreference | undefined {
  return preference
    ? { ...preference, events: [...preference.events], mentionUserIds: [...preference.mentionUserIds], sinks: [...preference.sinks] }
    : undefined;
}
