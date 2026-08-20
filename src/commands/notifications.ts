import type { NotificationEvent, NotificationPreference } from '../bot/notification-preference-store.js';
import { bilingualMarkdown } from '../card/i18n.js';
import type { CommandContext } from './index.js';

const ALL_EVENTS: NotificationEvent[] = ['completed', 'failed', 'approval'];

async function reply(ctx: CommandContext, zh: string, en: string): Promise<void> {
  await ctx.channel.sendMarkdown(ctx.chatId, bilingualMarkdown(zh, en), { replyTo: ctx.messageId });
}

export async function handleNotifications(args: string, ctx: CommandContext): Promise<void> {
  const store = ctx.notificationPreferences;
  if (!store) {
    await reply(ctx, '当前运行环境未启用通知偏好。', 'Notification preferences are unavailable in this runtime.');
    return;
  }
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens[0] === 'show') {
    const value = store.resolve(ctx.scope, ctx.defaultNotificationPreference);
    if (!value) {
      await reply(ctx, '当前 scope 的主动提醒：**关闭**（默认）。用 `/notifications on` 开启。', 'Proactive notifications for this scope: **off** (default). Use `/notifications on` to enable them.');
      return;
    }
    await reply(ctx, describe(value, true), describe(value, false));
    return;
  }
  if (tokens[0] === 'off') {
    await store.set(ctx.scope, false);
    await reply(ctx, '已关闭当前 scope 的主动提醒。', 'Disabled proactive notifications for this scope.');
    return;
  }
  if (tokens[0] === 'default') {
    await store.set(ctx.scope, undefined);
    await reply(ctx, '已恢复 Web 设置中的默认提醒策略。', 'Restored the notification default from Web settings.');
    return;
  }
  if (tokens[0] !== 'on') {
    await usage(ctx);
    return;
  }

  let target: string | undefined;
  let events = [...ALL_EVENTS];
  let mentionUserIds = ctx.senderId ? [ctx.senderId] : [];
  let reminderMinutes = 10;
  for (const token of tokens.slice(1)) {
    if (token.startsWith('events=')) {
      const requested = token.slice(7).split(',').filter(Boolean);
      if (requested.length === 0 || requested.some((event) => !ALL_EVENTS.includes(event as NotificationEvent))) return usage(ctx);
      events = [...new Set(requested)] as NotificationEvent[];
    } else if (token.startsWith('mentions=')) {
      const value = token.slice(9);
      mentionUserIds = value === 'none' ? [] : value.split(',').map((id) => id === 'self' ? ctx.senderId ?? '' : id).filter(Boolean);
    } else if (token.startsWith('remind=')) {
      reminderMinutes = Number(token.slice(7));
      if (!Number.isInteger(reminderMinutes) || reminderMinutes < 1 || reminderMinutes > 1_440) return usage(ctx);
    } else if (!target) {
      target = token === 'current' ? undefined : token;
    } else return usage(ctx);
  }
  if (target) {
    if (!ctx.accessManager.isAdmin(ctx.senderId)) {
      await reply(ctx, '只有管理员可把提醒发送到其他会话。', 'Only admins can route notifications to another session.');
      return;
    }
    if (!ctx.scopeDirectory.resolve(target) && !ctx.scopeDirectory.resolveChat(target)) {
      await reply(ctx, `未知目标：\`${target}\`。可用 \`/notify list\` 查看已登记 scope。`, `Unknown target: \`${target}\`. Use \`/notify list\` to see registered scopes.`);
      return;
    }
  }
  const value: NotificationPreference = {
    ...(target ? { target } : {}),
    events,
    mentionUserIds: [...new Set(mentionUserIds)],
    approvalReminderMs: reminderMinutes * 60_000,
  };
  await store.set(ctx.scope, value);
  await reply(ctx, `已开启。${describe(value, true)}`, `Enabled. ${describe(value, false)}`);
}

function describe(value: NotificationPreference, zh: boolean): string {
  const minutes = value.approvalReminderMs / 60_000;
  return zh
    ? `主动提醒：**开启** · 事件 \`${value.events.join(',')}\` · 目标 \`${value.target ?? 'current'}\` · @ \`${value.mentionUserIds.join(',') || 'none'}\` · 审批提醒 ${String(minutes)} 分钟。`
    : `Proactive notifications: **on** · events \`${value.events.join(',')}\` · target \`${value.target ?? 'current'}\` · mentions \`${value.mentionUserIds.join(',') || 'none'}\` · approval reminder ${String(minutes)} min.`;
}

async function usage(ctx: CommandContext): Promise<void> {
  await reply(ctx,
    '用法：`/notifications [show|off|default|on [current|scope|chatId] [events=completed,failed,approval] [mentions=self,ou_x|none] [remind=10]]`',
    'Usage: `/notifications [show|off|default|on [current|scope|chatId] [events=completed,failed,approval] [mentions=self,ou_x|none] [remind=10]]`',
  );
}
