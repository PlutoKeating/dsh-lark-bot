import type { ScopeDirectory } from '../bridge/scope-directory.js';
import type { SendOptions } from '../bridge/send-options.js';
import { bilingualMarkdown } from '../card/i18n.js';
import type { NotificationEvent, NotificationPreferenceStore } from '../bot/notification-preference-store.js';
import { log } from '../core/logger.js';

export class NotificationDispatcher {
  constructor(private readonly deps: {
    preferences: NotificationPreferenceStore;
    scopeDirectory: ScopeDirectory;
    send(chatId: string, markdown: string, options?: SendOptions): Promise<void>;
  }) {}

  async notify(scope: string, event: NotificationEvent, detail?: string): Promise<boolean> {
    const preference = this.deps.preferences.get(scope);
    if (!preference?.events.includes(event)) return false;
    const destination = preference.target
      ? this.deps.scopeDirectory.resolve(preference.target) ?? this.deps.scopeDirectory.resolveChat(preference.target)
      : this.deps.scopeDirectory.resolve(scope);
    if (!destination) {
      log.warn('notification', 'target-unavailable', { scope, target: preference.target });
      return false;
    }
    const title = event === 'completed'
      ? ['✅ 任务已完成', '✅ Task completed']
      : event === 'failed'
        ? ['⚠️ 任务执行失败', '⚠️ Task failed']
        : ['⏳ 任务仍在等待操作审批', '⏳ Task is still waiting for tool approval'];
    try {
      await this.deps.send(destination.chatId, bilingualMarkdown(
        `${title[0]}（scope \`${scope}\`）${detail ? `：${detail}` : ''}`,
        `${title[1]} (scope \`${scope}\`)${detail ? `: ${detail}` : ''}`,
      ), {
        ...(destination.threadId ? { threadId: destination.threadId } : {}),
        ...(destination.messageId ? { replyTo: destination.messageId } : {}),
        ...(preference.mentionUserIds.length > 0
          ? { mentions: preference.mentionUserIds.map((userId) => ({ userId })) }
          : {}),
      });
      return true;
    } catch (error) {
      log.warn('notification', 'send-failed', { scope, event, error });
      return false;
    }
  }

  scheduleApprovalReminder(scope: string, toolName: string): () => void {
    const preference = this.deps.preferences.get(scope);
    if (!preference?.events.includes('approval')) return () => undefined;
    const timer = setTimeout(() => { void this.notify(scope, 'approval', `tool \`${toolName}\``); }, preference.approvalReminderMs);
    timer.unref?.();
    return () => clearTimeout(timer);
  }
}
