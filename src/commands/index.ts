import { resolve } from 'node:path';
import type { ActiveRuns } from '../bot/active-runs.js';
import type { RunPolicyStore } from '../bot/run-policy.js';
import type { AccessManager } from '../config/access-manager.js';
import type { SessionStore } from '../session/store.js';
import type { WorkspaceStore } from '../workspace/store.js';

export interface CommandChannel {
  sendMarkdown(
    chatId: string,
    markdown: string,
    options?: { replyTo?: string },
  ): Promise<void>;
}

export interface CommandContext {
  scope: string;
  chatId: string;
  messageId: string;
  threadId: string | undefined;
  chatMode: 'p2p' | 'group' | 'topic';
  sessions: SessionStore;
  workspaces: WorkspaceStore;
  activeRuns: ActiveRuns;
  runPolicies: RunPolicyStore;
  defaultRunTimeoutMs: number;
  accessManager: AccessManager;
  channel: CommandChannel;
  defaultWorkspace: string;
}

type Handler = (args: string, ctx: CommandContext) => Promise<void>;

const HELP = [
  '**dsh-lark-bot 命令**',
  '',
  '- `/new` `/reset` — 开始新会话',
  '- `/cd <path>` — 切换工作目录并重置会话',
  '- `/ws list|save <name>|use <name>|remove <name>` — 管理工作空间',
  '- `/status` — 查看当前状态',
  '- `/stop` — 终止当前任务',
  '- `/timeout [N|off|default]` — 查看或设置当前会话运行超时',
  '- `/invite user|admin|group <id>` — 管理访问白名单',
  '- `/help` — 显示本帮助',
].join('\n');

async function reply(ctx: CommandContext, markdown: string): Promise<void> {
  await ctx.channel.sendMarkdown(ctx.chatId, markdown, {
    replyTo: ctx.messageId,
  });
}

async function handleNew(_args: string, ctx: CommandContext): Promise<void> {
  const wasRunning = await ctx.activeRuns.interrupt(ctx.scope);
  ctx.sessions.clear(ctx.scope);
  await reply(ctx, wasRunning ? '已中断当前任务并开始新会话。' : '已开始新会话。');
}

async function handleCd(args: string, ctx: CommandContext): Promise<void> {
  const path = args.trim();
  if (!path) {
    await reply(ctx, '用法：`/cd <path>`');
    return;
  }
  const cwd = resolve(path);
  await ctx.activeRuns.interrupt(ctx.scope);
  ctx.workspaces.setCwd(ctx.scope, cwd);
  ctx.sessions.clear(ctx.scope);
  await reply(ctx, `已切换工作目录：\`${cwd}\`，会话已重置。`);
}

async function handleWs(args: string, ctx: CommandContext): Promise<void> {
  const [sub, ...rest] = args.trim().split(/\s+/);
  const name = rest.join(' ').trim();

  if (!sub || sub === 'list') {
    const current = ctx.workspaces.cwdFor(ctx.scope) ?? ctx.defaultWorkspace;
    const named = ctx.workspaces.listNamed();
    const lines = Object.entries(named).map(
      ([key, value]) => `- **${key}** → \`${value}\`${value === current ? ' ← 当前' : ''}`,
    );
    await reply(
      ctx,
      [
        `当前 cwd：\`${current}\``,
        '',
        ...(lines.length > 0 ? lines : ['暂无命名工作空间。']),
      ].join('\n'),
    );
    return;
  }

  if (sub === 'save') {
    if (!name) {
      await reply(ctx, '用法：`/ws save <name>`');
      return;
    }
    const current = ctx.workspaces.cwdFor(ctx.scope) ?? ctx.defaultWorkspace;
    ctx.workspaces.saveNamed(name, current);
    await reply(ctx, `已保存工作空间：**${name}** → \`${current}\``);
    return;
  }

  if (sub === 'use') {
    if (!name) {
      await reply(ctx, '用法：`/ws use <name>`');
      return;
    }
    const cwd = ctx.workspaces.getNamed(name);
    if (!cwd) {
      await reply(ctx, `未找到工作空间：**${name}**`);
      return;
    }
    await ctx.activeRuns.interrupt(ctx.scope);
    ctx.workspaces.setCwd(ctx.scope, cwd);
    ctx.sessions.clear(ctx.scope);
    await reply(ctx, `已切换到工作空间：**${name}** → \`${cwd}\``);
    return;
  }

  if (sub === 'remove') {
    if (!name) {
      await reply(ctx, '用法：`/ws remove <name>`');
      return;
    }
    const removed = ctx.workspaces.removeNamed(name);
    await reply(ctx, removed ? `已删除工作空间：**${name}**` : `未找到工作空间：**${name}**`);
    return;
  }

  await reply(ctx, '未知 `/ws` 子命令，请使用 list / save / use / remove。');
}

async function handleStatus(_args: string, ctx: CommandContext): Promise<void> {
  const cwd = ctx.workspaces.cwdFor(ctx.scope) ?? ctx.defaultWorkspace;
  const session = ctx.sessions.getRaw(ctx.scope)?.sessionId ?? '(无)';
  const running = Boolean(ctx.activeRuns.get(ctx.scope));
  const scopeLabel =
    ctx.chatMode === 'topic' ? `${ctx.scope}（话题独立 session）` : ctx.scope;

  await reply(
    ctx,
    [
      `🧭 **scope**: \`${scopeLabel}\``,
      `📁 **cwd**: \`${cwd}\``,
      `🔗 **session**: \`${session}\``,
      `🏃 **active run**: ${running ? 'yes' : 'no'}`,
    ].join('\n'),
  );
}

async function handleStop(_args: string, ctx: CommandContext): Promise<void> {
  const stopped = await ctx.activeRuns.interrupt(ctx.scope);
  await reply(ctx, stopped ? '已请求终止当前任务。' : '当前没有运行中的任务。');
}

async function handleTimeout(args: string, ctx: CommandContext): Promise<void> {
  const input = args.trim();
  const effectiveMs = ctx.runPolicies.get(ctx.scope) ?? ctx.defaultRunTimeoutMs;

  if (!input) {
    const minutes = effectiveMs > 0 ? Math.round(effectiveMs / 60_000) : 0;
    await reply(
      ctx,
      minutes > 0
        ? `当前会话运行超时：${minutes} 分钟。可用 \`/timeout <N|off|default>\` 调整。`
        : '当前会话运行超时：关闭。',
    );
    return;
  }

  if (input === 'off') {
    ctx.runPolicies.set(ctx.scope, 0);
    await reply(ctx, '已关闭当前会话运行超时。');
    return;
  }

  if (input === 'default') {
    ctx.runPolicies.clear(ctx.scope);
    await reply(ctx, '已恢复默认运行超时。');
    return;
  }

  const minutes = Number(input);
  if (!Number.isInteger(minutes) || minutes <= 0) {
    await reply(ctx, '用法：`/timeout <N|off|default>`，N 为大于 0 的分钟数。');
    return;
  }

  ctx.runPolicies.set(ctx.scope, minutes * 60_000);
  await reply(ctx, `已设置当前会话运行超时：${minutes} 分钟。`);
}

async function handleInvite(args: string, ctx: CommandContext): Promise<void> {
  const [kind, ...rest] = args.trim().split(/\s+/);
  const id = rest.join(' ').trim();
  if (!kind || !id) {
    await reply(ctx, '用法：`/invite user <id>`、`/invite admin <id>`、`/invite group <chatId>`');
    return;
  }

  if (kind === 'user') {
    await ctx.accessManager.addUser(id);
    await reply(ctx, `已允许用户：\`${id}\``);
    return;
  }

  if (kind === 'admin') {
    await ctx.accessManager.addAdmin(id);
    await reply(ctx, `已设为管理员：\`${id}\``);
    return;
  }

  if (kind === 'group') {
    await ctx.accessManager.addChat(id);
    await reply(ctx, `已允许群聊：\`${id}\``);
    return;
  }

  await reply(ctx, '未知 `/invite` 类型，请使用 user / admin / group。');
}

async function handleHelp(_args: string, ctx: CommandContext): Promise<void> {
  await reply(ctx, HELP);
}

const handlers: Record<string, Handler> = {
  '/new': handleNew,
  '/reset': handleNew,
  '/cd': handleCd,
  '/ws': handleWs,
  '/status': handleStatus,
  '/stop': handleStop,
  '/timeout': handleTimeout,
  '/invite': handleInvite,
  '/help': handleHelp,
};

export async function tryHandleCommand(text: string, ctx: CommandContext): Promise<boolean> {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return false;
  const [command, ...rest] = trimmed.split(/\s+/);
  const handler = handlers[command ?? ''];
  if (!handler) return false;
  await handler(rest.join(' '), ctx);
  return true;
}
