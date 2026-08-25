import type { CommandContext } from './index.js';
import { bilingualMarkdown } from '../card/i18n.js';
import { SINK_TYPES } from '../notify/sinks/channel-store.js';
import { maskChannel, maskSecret, type SinkChannel, type SinkType } from '../notify/sinks/types.js';

async function reply(ctx: CommandContext, zh: string, en: string): Promise<void> {
  await ctx.channel.sendMarkdown(ctx.chatId, bilingualMarkdown(zh, en), { replyTo: ctx.messageId });
}

function requireAdmin(ctx: CommandContext): boolean {
  if (ctx.accessManager.isAdmin(ctx.senderId)) return true;
  void reply(ctx, '仅管理员可管理通知渠道。', 'Only admins can manage notification channels.');
  return false;
}

/**
 * `/channels` — manage the push-only outbound notification channels
 * (issue #113). Admin-only. Credentials are stored at mode 0600 and every
 * response renders a masked value so the secret is never echoed back.
 */
export async function handleChannels(args: string, ctx: CommandContext): Promise<void> {
  if (!requireAdmin(ctx)) return;
  const store = ctx.notificationChannels;
  if (!store) {
    await reply(ctx, '当前运行环境未启用通知渠道管理。', 'Notification channel management is unavailable in this runtime.');
    return;
  }
  const [sub, ...rest] = args.trim().split(/\s+/);
  switch (sub) {
    case 'list':
      return listChannels(ctx, store);
    case 'show': {
      const id = rest[0];
      if (!id) return usage(ctx);
      const channel = store.get(id);
      if (!channel) return notFound(ctx, id);
      return showChannel(ctx, channel);
    }
    case 'add':
      return addChannel(ctx, store, rest.join(' '));
    case 'remove': {
      const id = rest[0];
      if (!id) return usage(ctx);
      const ok = await store.remove(id);
      return ok
        ? reply(ctx, `已移除通知渠道 \`${id}\`。`, `Removed notification channel \`${id}\`.`)
        : notFound(ctx, id);
    }
    case 'enable':
    case 'disable': {
      const id = rest[0];
      if (!id) return usage(ctx);
      const enabled = sub === 'enable';
      const ok = await store.setEnabled(id, enabled);
      if (!ok) return notFound(ctx, id);
      return reply(ctx, `已${enabled ? '启用' : '停用'}通知渠道 \`${id}\`。`, `${enabled ? 'Enabled' : 'Disabled'} notification channel \`${id}\`.`);
    }
    default:
      return usage(ctx);
  }
}

async function listChannels(ctx: CommandContext, store: NonNullable<typeof ctx.notificationChannels>): Promise<void> {
  const channels = store.list();
  if (channels.length === 0) {
    await reply(ctx, '尚未配置任何通知渠道。用 `/channels add telegram|wecom <label> --destination <目标> --secret <密钥>` 添加。', 'No notification channels yet. Use `/channels add telegram|wecom <label> --destination <target> --secret <token>` to add one.');
    return;
  }
  const lines = channels.map((channel) => `- ${channel.enabled ? '🟢' : '⚪️'} \`${channel.id}\` — ${channel.type} · ${channel.label} · ${maskSecret(channel.destination)}`);
  await reply(ctx, ['**已配置通知渠道**', '', ...lines].join('\n'), ['**Configured notification channels**', '', ...lines].join('\n'));
}

async function showChannel(ctx: CommandContext, channel: SinkChannel): Promise<void> {
  const zh = `**${channel.id}**\n- 类型：\`${channel.type}\`\n- 名称：${channel.label}\n- 目标：\`${maskSecret(channel.destination)}\`\n- 状态：${channel.enabled ? '启用' : '停用'}\n- 密钥：\`${maskSecret(channel.secret)}\``;
  const en = `**${channel.id}**\n- Type: \`${channel.type}\`\n- Label: ${channel.label}\n- Target: \`${maskSecret(channel.destination)}\`\n- Status: ${channel.enabled ? 'enabled' : 'disabled'}\n- Secret: \`${maskSecret(channel.secret)}\``;
  await reply(ctx, zh, en);
}

async function addChannel(ctx: CommandContext, store: NonNullable<typeof ctx.notificationChannels>, raw: string): Promise<void> {
  const parsed = parseAddArgs(raw);
  if (!parsed || !parsed.type || !parsed.label || !parsed.destination || !parsed.secret) {
    await usage(ctx);
    return;
  }
  if (!(SINK_TYPES as readonly string[]).includes(parsed.type)) {
    await reply(ctx, `不支持的渠道类型：\`${parsed.type}\`。可用：\`${SINK_TYPES.join('|')}\`。`, `Unsupported channel type: \`${parsed.type}\`. Available: \`${SINK_TYPES.join('|')}\`.`);
    return;
  }
  const id = parsed.id ?? `${parsed.type}-${slugify(parsed.label)}`;
  if (store.get(id)) {
    await reply(ctx, `通知渠道 \`${id}\` 已存在。用 \`/channels remove ${id}\` 删除后重建。`, `Notification channel \`${id}\` already exists. Remove it first with \`/channels remove ${id}\`.`);
    return;
  }
  const channel: SinkChannel = {
    id,
    type: parsed.type as SinkType,
    label: parsed.label,
    destination: parsed.destination,
    secret: parsed.secret,
    enabled: true,
  };
  await store.add(channel);
  await reply(ctx, `已添加通知渠道 ${maskChannel(channel)}。`, `Added notification channel ${maskChannel(channel)}.`);
}

async function notFound(ctx: CommandContext, id: string): Promise<void> {
  await reply(ctx, `未找到通知渠道 \`${id}\`。用 \`/channels list\` 查看。`, `Unknown notification channel \`${id}\`. Use \`/channels list\`.`);
}

async function usage(ctx: CommandContext): Promise<void> {
  await reply(ctx,
    '用法：`/channels list|show <id>|add <telegram|wecom> <label> [--id <id>] --destination <目标> --secret <密钥>|remove <id>|enable <id>|disable <id>`',
    'Usage: `/channels list|show <id>|add <telegram|wecom> <label> [--id <id>] --destination <target> --secret <token>|remove <id>|enable <id>|disable <id>`',
  );
}

function parseAddArgs(raw: string): {
  id?: string; type?: string; label?: string; destination?: string; secret?: string;
} | undefined {
  if (!raw.trim()) return undefined;
  const idMatch = raw.match(/--id\s+(\S+)/);
  const destMatch = raw.match(/--destination\s+(\S+)/);
  const secretMatch = raw.match(/--secret\s+(\S+)/);
  const positionals = raw
    .replace(/\s*--id\s+\S+/, ' ')
    .replace(/\s*--destination\s+\S+/, ' ')
    .replace(/\s*--secret\s+\S+/, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const [type, label] = positionals;
  return {
    ...(idMatch ? { id: idMatch[1] } : {}),
    ...(type ? { type } : {}),
    ...(label ? { label } : {}),
    ...(destMatch ? { destination: destMatch[1] } : {}),
    ...(secretMatch ? { secret: secretMatch[1] } : {}),
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'channel';
}
