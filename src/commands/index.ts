import { resolve } from 'node:path';
import type { ActiveRuns } from '../bot/active-runs.js';
import type { ApprovalRegistry } from '../bot/approvals.js';
import type { DensityStore } from '../bot/density-store.js';
import type { QuestionRegistry } from '../bot/questions.js';
import type { RunPolicyStore } from '../bot/run-policy.js';
import type { AccessManager } from '../config/access-manager.js';
import type { SessionStore } from '../session/store.js';
import type { WorkspaceStore } from '../workspace/store.js';
import { renderWorkspaceCard } from '../card/workspace-card.js';
import { parseCardDensity, type CardDensity } from '../card/density.js';
import { questionHandlerFor } from '../bridge/run-flow.js';

export interface CommandChannel {
  sendMarkdown(
    chatId: string,
    markdown: string,
    options?: { replyTo?: string },
  ): Promise<void>;
  sendCard?(chatId: string, card: object): Promise<void>;
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
  approvals: ApprovalRegistry | undefined;
  questions: QuestionRegistry | undefined;
  densityStore: DensityStore | undefined;
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
  '- `/resume` — 查看当前会话最近上下文',
  '- `/stop` — 终止当前任务',
  '- `/timeout [N|off|default]` — 查看或设置当前会话运行超时',
  '- `/density [compact|standard|detailed]` — 查看或设置卡片密度',
  '- `/ask <问题>` — 发送结构化问答卡（回答将记入会话）',
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
    const index = ctx.workspaces.listIndex();
    if (ctx.channel.sendCard) {
      await ctx.channel.sendCard(ctx.chatId, renderWorkspaceCard({ current, index }));
      return;
    }
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
    ctx.workspaces.touchNamed(name);
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

async function handleResume(_args: string, ctx: CommandContext): Promise<void> {
  const cwd = ctx.workspaces.cwdFor(ctx.scope) ?? ctx.defaultWorkspace;
  const history = ctx.sessions.historyFor(ctx.scope, cwd);
  if (history.length === 0) {
    await reply(ctx, '当前会话没有历史上下文。');
    return;
  }

  const recent = history.slice(-6).map((message) => {
    const speaker = message.role === 'user' ? '👤' : '🤖';
    return `${speaker} ${message.content.slice(0, 300)}`;
  });

  await reply(ctx, [`当前 scope：\`${ctx.scope}\``, '', ...recent].join('\n'));
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

async function handleDensity(args: string, ctx: CommandContext): Promise<void> {
  const input = args.trim().toLowerCase();
  if (!input) {
    const current = ctx.densityStore?.get(ctx.scope) ?? 'standard';
    await reply(
      ctx,
      `当前卡片密度：**${current}**。可用 \`/density compact|standard|detailed\` 调整。`,
    );
    return;
  }
  if (input === 'default') {
    ctx.densityStore?.clear(ctx.scope);
    await reply(ctx, '已恢复默认卡片密度。');
    return;
  }
  const density: CardDensity | undefined = parseCardDensity(input);
  if (!density) {
    await reply(ctx, '用法：`/density [compact|standard|detailed|default]`');
    return;
  }
  ctx.densityStore?.set(ctx.scope, density);
  await reply(ctx, `已设置当前会话卡片密度：**${density}**。`);
}

async function handleAsk(args: string, ctx: CommandContext): Promise<void> {
  const question = args.trim();
  if (!question) {
    await reply(ctx, '用法：`/ask <问题>`');
    return;
  }
  if (!ctx.questions) {
    await reply(ctx, '问答卡未启用（请确认 questions 已接线）。');
    return;
  }
  const answer = await questionHandlerFor({
    questions: ctx.questions,
    channel: ctx.channel,
    chatId: ctx.chatId,
    scope: ctx.scope,
  })({
    kind: 'text',
    question,
    id: '',
  });
  if (answer !== undefined) {
    const text = Array.isArray(answer) ? answer.join('、') : answer;
    ctx.sessions.recordExchange(ctx.scope, ctx.workspaces.cwdFor(ctx.scope) ?? ctx.defaultWorkspace, [text], undefined);
    await reply(ctx, `已记录你的回答，并写入会话上下文。`);
  } else {
    await reply(ctx, '未收到回答（卡片可能已超时或被忽略）。');
  }
}

async function handleInvite(args: string, ctx: CommandContext): Promise<void> {
  const [kind, ...rest] = args.trim().split(/\s+/);
  const id = rest.join(' ').trim();

  if (kind === 'list') {
    const snapshot = ctx.accessManager.snapshot();
    await reply(
      ctx,
      [
        '**访问白名单**',
        `users: ${snapshot.allowedUsers.join(', ') || '(空)'}`,
        `chats: ${snapshot.allowedChats.join(', ') || '(空)'}`,
        `admins: ${snapshot.admins.join(', ') || '(空)'}`,
      ].join('\n'),
    );
    return;
  }

  if (!kind || !id) {
    await reply(
      ctx,
      '用法：`/invite user|admin|group <id>`、`/invite list`、`/invite remove user|group <id>`',
    );
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

  if (kind === 'remove') {
    const [sub, target] = rest;
    if (sub === 'user' && target) {
      await ctx.accessManager.removeUser(target);
      await reply(ctx, `已移除用户：\`${target}\``);
      return;
    }
    if (sub === 'group' && target) {
      await ctx.accessManager.removeChat(target);
      await reply(ctx, `已移除群聊：\`${target}\``);
      return;
    }
    await reply(ctx, '用法：`/invite remove user <id>` 或 `/invite remove group <chatId>`');
    return;
  }

  await reply(ctx, '未知 `/invite` 类型，请使用 user / admin / group / list / remove。');
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
  '/resume': handleResume,
  '/stop': handleStop,
  '/timeout': handleTimeout,
  '/density': handleDensity,
  '/ask': handleAsk,
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
