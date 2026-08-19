import type { CommandContext } from './index.js';
import { bilingualMarkdown } from '../card/i18n.js';

async function reply(ctx: CommandContext, zhCn: string, enUs: string): Promise<void> {
  await ctx.channel.sendMarkdown(ctx.chatId, bilingualMarkdown(zhCn, enUs), {
    replyTo: ctx.messageId,
  });
}

/** `/notify <scope|chatId> <text>` — admin-only cross-session messaging. */
async function handleNotifySend(args: string, ctx: CommandContext): Promise<void> {
  if (!ctx.accessManager.isAdmin(ctx.senderId)) {
    await reply(ctx, '仅管理员可执行该操作。', 'Only admins can perform this operation.');
    return;
  }
  const match = args.trim().match(/^(\S+)\s+([\s\S]+)$/);
  if (!match) {
    await reply(ctx, '用法：`/notify <scope|chatId> <text>`', 'Usage: `/notify <scope|chatId> <text>`');
    return;
  }
  const target = match[1] ?? '';
  const text = match[2]?.trim() ?? '';
  if (!text) {
    await reply(ctx, '用法：`/notify <scope|chatId> <text>`', 'Usage: `/notify <scope|chatId> <text>`');
    return;
  }

  const destination =
    ctx.scopeDirectory.resolve(target) ?? ctx.scopeDirectory.resolveChat(target);
  if (!destination) {
    await reply(
      ctx,
      `未知的目标 scope/chat：\`${target}\`。可用 \`/notify list\` 查看已注册的 scope。`,
      `Unknown target scope/chat: \`${target}\`. Use \`/notify list\` to list registered scopes.`,
    );
    return;
  }
  await ctx.channel.sendMarkdown(destination.chatId, text, {
    ...(destination.threadId ? { threadId: destination.threadId } : {}),
  });
  await reply(ctx, `已发送通知到 \`${target}\`（chat \`${destination.chatId}\`）。`, `Sent the notification to \`${target}\` (chat \`${destination.chatId}\`).`);
}

/** `/notify list` — show every scope known to the bridge. */
async function handleNotifyList(_args: string, ctx: CommandContext): Promise<void> {
  const scopes = ctx.scopeDirectory.knownScopes();
  if (scopes.length === 0) {
    await reply(ctx, '暂无已注册的 scope（至少需要一个会话发过消息）。', 'No scopes are registered yet (a session must send at least one message).');
    return;
  }
  const lines = scopes.map((scope) => {
    const entry = ctx.scopeDirectory.resolve(scope);
    return `- \`${scope}\` → chat \`${entry?.chatId ?? ''}\`${entry?.threadId ? ` / thread \`${entry.threadId}\`` : ''}`;
  });
  await reply(ctx, ['**已注册 scope**', '', ...lines].join('\n'), ['**Registered scopes**', '', ...lines].join('\n'));
}

export async function handleNotify(args: string, ctx: CommandContext): Promise<void> {
  const [sub, ...rest] = args.trim().split(/\s+/);
  if (sub === 'list') {
    await handleNotifyList(rest.join(' ').trim(), ctx);
    return;
  }
  await handleNotifySend(args, ctx);
}
