import type { ReplyPolicy } from '../bot/reply-policy-store.js';
import { bilingualMarkdown } from '../card/i18n.js';
import type { CommandContext } from './index.js';

export async function handleReplies(args: string, ctx: CommandContext): Promise<void> {
  const store = ctx.replyPolicies;
  if (!store) return reply(ctx, '当前运行环境未启用回复策略。', 'Reply policies are unavailable in this runtime.');
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens[0] === 'show') return reply(ctx, describe(store.get(ctx.scope), store.isConfigured(ctx.scope), true), describe(store.get(ctx.scope), store.isConfigured(ctx.scope), false));
  if (!ctx.accessManager.isAdmin(ctx.senderId)) return reply(ctx, '仅管理员可修改回复策略。', 'Only admins can change reply policies.');
  if (tokens[0] === 'default') {
    await store.set(ctx.scope, undefined);
    return reply(ctx, '已恢复默认即时回复与仅 messageId 去重。', 'Restored immediate replies and message-ID-only deduplication.');
  }
  if (tokens[0] !== 'set') return usage(ctx);
  const policy = { ...store.get(ctx.scope) };
  for (const token of tokens.slice(1)) {
    const [key, raw, extra] = token.split('=');
    if (!raw || extra !== undefined) return usage(ctx);
    const seconds = Number(raw);
    if (!Number.isInteger(seconds)) return usage(ctx);
    if (key === 'merge' && seconds >= 0 && seconds <= 300) policy.mergeWindowMs = seconds * 1_000;
    else if (key === 'batch' && seconds >= 1 && seconds <= 20) policy.maxBatchSize = seconds;
    else if (key === 'interval' && seconds >= 0 && seconds <= 3_600) policy.minIntervalMs = seconds * 1_000;
    else if (key === 'dedupe' && seconds >= 0 && seconds <= 3_600) policy.dedupeWindowMs = seconds * 1_000;
    else return usage(ctx);
  }
  if (tokens.length === 1) return usage(ctx);
  await store.set(ctx.scope, policy);
  await reply(ctx, `已设置。${describe(policy, true, true)}`, `Updated. ${describe(policy, true, false)}`);
}

function describe(policy: ReplyPolicy, configured: boolean, zh: boolean): string {
  return zh
    ? `回复策略：**${configured ? '自定义' : '默认'}** · 合并 ${String(policy.mergeWindowMs / 1_000)} 秒 · 每批 ${String(policy.maxBatchSize)} 个任务 · 间隔 ${String(policy.minIntervalMs / 1_000)} 秒 · 近似去重 ${String(policy.dedupeWindowMs / 1_000)} 秒。`
    : `Reply policy: **${configured ? 'custom' : 'default'}** · merge ${String(policy.mergeWindowMs / 1_000)}s · ${String(policy.maxBatchSize)} tasks/batch · interval ${String(policy.minIntervalMs / 1_000)}s · near-dedupe ${String(policy.dedupeWindowMs / 1_000)}s.`;
}

async function usage(ctx: CommandContext): Promise<void> {
  await reply(ctx, '用法：`/replies [show|default|set merge=秒 batch=数量 interval=秒 dedupe=秒]`', 'Usage: `/replies [show|default|set merge=seconds batch=count interval=seconds dedupe=seconds]`');
}

async function reply(ctx: CommandContext, zh: string, en: string): Promise<void> {
  await ctx.channel.sendMarkdown(ctx.chatId, bilingualMarkdown(zh, en), { replyTo: ctx.messageId });
}
