import type { CommandContext } from './index.js';
import { bilingualMarkdown } from '../card/i18n.js';
import { SINK_TYPES } from '../notify/sinks/channel-store.js';
import { maskChannel, maskSecret, type SinkChannel, type SinkType } from '../notify/sinks/types.js';
import { SinkQrRegistry, pollUntilCompleted } from '../onboard/sink-qr.js';
import { buildSinkQrProviders, coerceSinkQrChannel } from '../onboard/sink-qr-providers.js';
import { renderQrPng } from '../onboard/qr-image.js';

const QR_REGISTRY = new SinkQrRegistry(buildSinkQrProviders());

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
    case 'accept':
      return acceptChannel(ctx, store, rest.join(' '));
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
  if (raw.trim().startsWith('--qr')) return addChannelByQr(ctx, store, raw.trim());
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

/** Friendly platform name for a QR-bound sink (falls back to its type id). */
function platformName(type: SinkType): string {
  const names: Record<SinkType, string> = {
    telegram: 'Telegram',
    wecom: '企业微信',
    wechat: '微信',
    qq: 'QQ',
  };
  return names[type] ?? type;
}

/** `/channels add --qr <type> [--id <id>] [--label <label>]` — scan-to-bind. */
async function addChannelByQr(ctx: CommandContext, store: NonNullable<typeof ctx.notificationChannels>, raw: string): Promise<void> {
  const parsed = parseQrArgs(raw);
  const type = parsed.type as SinkType | undefined;
  if (!type) {
    await reply(ctx, '用法：`/channels add --qr <wechat|qq|telegram> [--id <id>] [--label <label>]`', 'Usage: `/channels add --qr <wechat|qq|telegram> [--id <id>] [--label <label>]`');
    return;
  }
  if (!(SINK_TYPES as readonly string[]).includes(type)) {
    await reply(ctx, `不支持的渠道类型：\`${type}\`。可用：\`${SINK_TYPES.join('|')}\`。`, `Unsupported channel type: \`${type}\`. Available: \`${SINK_TYPES.join('|')}\`.`);
    return;
  }
  const provider = QR_REGISTRY.forType(type);
  if (!provider) {
    await reply(ctx, `\`${type}\` 暂无扫码绑定支持，请改用 \`/channels add ${type} <label> --destination <目标> --secret <密钥>\`。`, `\`${type}\` has no QR binding yet. Use \`/channels add ${type} <label> --destination <target> --secret <token>\` instead.`);
    return;
  }
  const id = parsed.id ?? `${type}-qr-${slugify(parsed.label ?? platformName(type))}`;
  if (store.get(id)) {
    await reply(ctx, `通知渠道 \`${id}\` 已存在。用 \`/channels remove ${id}\` 删除后重建。`, `Notification channel \`${id}\` already exists. Use \`/channels remove ${id}\` to recreate it.`);
    return;
  }
  let session;
  try {
    session = await provider.begin({ id, label: parsed.label ?? platformName(type) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await reply(ctx,
      `无法发起 ${platformName(type)} 扫码绑定：${message}。请改用手动方式 \`/channels add ${type} <label> --destination <目标> --secret <密钥>\`。`,
      `Could not start a ${platformName(type)} QR bind: ${message}. Use manual entry \`/channels add ${type} <label> --destination <target> --secret <token>\` instead.`,
    );
    return;
  }

  const png = await renderQrPng(session.qrUrl);
  const minutes = Math.max(1, Math.round(session.expireIn / 60));
  const introZh = `${platformName(type)}扫码绑定：请用「${platformName(type)}」App 扫描下方二维码创建 / 绑定通知会话，二维码约 ${minutes} 分钟有效。扫码后等待自动完成，或超时后用 \`/channels accept ${type} ${id} ${parsed.label ?? platformName(type)} <目标> <密钥>\`。`;
  const introEn = `${platformName(type)} QR bind: scan the code below with the ${platformName(type)} app to create / bind the notification session. It stays valid for about ${minutes} minute(s). After scanning it auto-completes, or use \`/channels accept ${type} ${id} ${parsed.label ?? platformName(type)} <target> <token>\` on timeout.`;
  if (typeof ctx.channel.sendImage === 'function') {
    await ctx.channel.sendImage(ctx.chatId, png, { replyTo: ctx.messageId });
  } else {
    await reply(ctx, `当前运行环境不支持发送图片，请浏览器打开：${session.qrUrl}`, `Image sending is unavailable here; open in a browser: ${session.qrUrl}`);
  }
  await reply(ctx, introZh, introEn);

  const result = await pollUntilCompleted(provider, session.sessionId, { timeoutMs: 90_000 });
  if (result.phase === 'completed' && result.channel) {
    const channel: SinkChannel = {
      ...coerceSinkQrChannel({
        id,
        type,
        label: result.channel.label || parsed.label || platformName(type),
        destination: result.channel.destination,
        secret: result.channel.secret,
      }),
      enabled: true,
    };
    await store.add(channel);
    await reply(ctx, `✅ 已绑定并添加通知渠道 ${maskChannel(channel)}。`, `✅ Bound and added notification channel ${maskChannel(channel)}.`);
    return;
  }
  const reason = result.phase === 'expired' ? '二维码已过期' : result.error ?? '未在等待时间内完成';
  await reply(ctx,
    `未完成${platformName(type)}扫码绑定（${reason}）。请重新用 \`/channels add --qr ${type}\` 发起，或手动填 \`/channels add ${type} <label> --destination <目标> --secret <密钥>\`。`,
    `${platformName(type)} QR bind did not complete (${reason}). Retry \`/channels add --qr ${type}\`, or enter it manually with \`/channels add ${type} <label> --destination <target> --secret <token>\`.`,
  );
}

/** `/channels accept <type> <id> <label> <destination> <secret>` — manual bind. */
async function acceptChannel(ctx: CommandContext, store: NonNullable<typeof ctx.notificationChannels>, raw: string): Promise<void> {
  const [type, id, label, destination, secret] = raw.trim().split(/\s+/);
  if (!type || !id || !label || !destination || !secret || !(SINK_TYPES as readonly string[]).includes(type)) {
    await reply(ctx, '用法：`/channels accept <type> <id> <label> <destination> <secret>`', 'Usage: `/channels accept <type> <id> <label> <destination> <secret>`');
    return;
  }
  if (store.get(id)) {
    await reply(ctx, `通知渠道 \`${id}\` 已存在。用 \`/channels remove ${id}\` 删除后重建。`, `Notification channel \`${id}\` already exists. Remove it first.`);
    return;
  }
  const channel: SinkChannel = {
    ...coerceSinkQrChannel({ id, type: type as SinkType, label, destination, secret }),
    enabled: true,
  };
  await store.add(channel);
  await reply(ctx, `已添加通知渠道 ${maskChannel(channel)}。`, `Added notification channel ${maskChannel(channel)}.`);
}

function parseQrArgs(raw: string): { type?: string; id?: string; label?: string } {
  const typeMatch = raw.match(/--qr\s+(\S+)/);
  const idMatch = raw.match(/--id\s+(\S+)/);
  const labelMatch = raw.match(/--label\s+(.+?)(?:\s--|\s*$)/);
  return {
    ...(typeMatch ? { type: typeMatch[1] } : {}),
    ...(idMatch ? { id: idMatch[1] } : {}),
    ...(labelMatch ? { label: labelMatch[1]!.trim() } : {}),
  };
}

async function notFound(ctx: CommandContext, id: string): Promise<void> {
  await reply(ctx, `未找到通知渠道 \`${id}\`。用 \`/channels list\` 查看。`, `Unknown notification channel \`${id}\`. Use \`/channels list\`.`);
}

async function usage(ctx: CommandContext): Promise<void> {
  await reply(ctx,
    '用法：`/channels list|show <id>|add --qr <wechat|qq|telegram> [--id <id>] [--label <label>]|add <type> <label> [--id <id>] --destination <目标> --secret <密钥>|accept <type> <id> <label> <destination> <secret>|remove <id>|enable <id>|disable <id>`',
    'Usage: `/channels list|show <id>|add --qr <wechat|qq|telegram> [--id <id>] [--label <label>]|add <type> <label> [--id <id>] --destination <target> --secret <token>|accept <type> <id> <label> <destination> <secret>|remove <id>|enable <id>|disable <id>`',
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
