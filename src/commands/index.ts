import { resolve } from 'node:path';
import type { ActiveRuns } from '../bot/active-runs.js';
import type { ApprovalRegistry } from '../bot/approvals.js';
import type { DensityStore } from '../bot/density-store.js';
import type { ConcurrencyStore } from '../bot/concurrency-store.js';
import type { QuestionRegistry } from '../bot/questions.js';
import type { RunPolicyStore } from '../bot/run-policy.js';
import type { RetentionStore } from '../bot/retention-store.js';
import type { RoleStore } from '../bot/role-store.js';
import type { AccessManager } from '../config/access-manager.js';
import type { SessionStore } from '../session/store.js';
import type { SessionArchive } from '../session/archive.js';
import type { ScopeDirectory } from '../bridge/scope-directory.js';
import type { SendOptions } from '../bridge/send-options.js';
import type { WorkspaceStore } from '../workspace/store.js';
import { renderWorkspaceCard } from '../card/workspace-card.js';
import { parseCardDensity, type CardDensity } from '../card/density.js';
import { questionHandlerFor } from '../bridge/run-flow.js';
import type { ModelStore } from '../bot/model-store.js';
import type { DshProviderManager } from '../config/dsh-config.js';
import {
  handleKey,
  handleModel,
  handleProvider,
  handleProviders,
} from './models.js';
import { handleArchive, handleRetention } from './archive.js';
import { handleRole } from './roles.js';
import { handleNotify } from './notify.js';

export interface CommandChannel {
  sendMarkdown(
    chatId: string,
    markdown: string,
    options?: SendOptions,
  ): Promise<void>;
  sendCard?(chatId: string, card: object): Promise<void>;
  /** Create a group chat and seed it with members (Feishu `im.v1.chat.create`). */
  createChat?(opts: {
    name: string;
    description?: string;
    inviteUserIds?: string[];
    userIdType?: 'open_id' | 'user_id' | 'union_id';
    chatMode?: 'group';
    chatType?: 'private' | 'public';
  }): Promise<{ chatId: string }>;
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
  concurrencyStore: ConcurrencyStore;
  defaultScopeConcurrency: number;
  retentionStore: RetentionStore;
  roleStore: RoleStore;
  scopeDirectory: ScopeDirectory;
  archiver: SessionArchive;
  defaultRetention: number;
  archiveMax: number;
  archiveMaxAgeDays: number;
  approvals: ApprovalRegistry | undefined;
  questions: QuestionRegistry | undefined;
  densityStore: DensityStore | undefined;
  models: ModelStore;
  dshConfig: DshProviderManager;
  defaultRunTimeoutMs: number;
  defaultModel: string;
  senderId: string | undefined;
  accessManager: AccessManager;
  channel: CommandChannel;
  defaultWorkspace: string;
}

type Handler = (args: string, ctx: CommandContext) => Promise<void>;

const HELP = [
  '**dsh-lark-bot 命令**',
  '',
  '- `/new` `/reset` — 开始新会话',
  '- `/newg <群名>` — 自动新建群聊（拉你入群）并开新会话，当前会话保留',
  '- `/cd <path>` — 切换工作目录并重置会话',
  '- `/ws list|save <name>|use <name>|remove <name>` — 管理工作空间',
  '- `/status` — 查看当前状态',
  '- `/resume` — 查看当前会话最近上下文',
  '- `/stop` — 终止当前任务',
  '- `/timeout [N|off|default]` — 查看或设置当前会话空闲超时（持续无活动事件 N 分钟才终止）',
  '- `/concurrency [N|default]` — 查看或设置当前 scope 的并行任务数',
  '- `/role list|show <id>|set <id>|clear` — 查看 / 绑定角色',
  '- `/role save <id> <name> [--persona 文案] [--model <id>] [--tools <csv>] [--rules 文案]` — 创建/更新角色（管理员）',
  '- `/role remove <id>` — 删除角色（管理员）',
  '- `/notify <scope|chatId> <text>` — 跨会话发送通知（管理员）',
  '- `/notify list` — 查看已注册 scope',
  '- `/retention [N|default]` — 查看或设置当前会话保留消息条数（超出自动归档）',
  '- `/archive [note]`、`/archive list [N]`、`/archive clean` — 归档 / 查看 / 清理会话',
  '- `/density [compact|standard|detailed]` — 查看或设置卡片密度',
  '- `/model` — 查看当前模型与 dsh 可用模型',
  '- `/model use <id>` — 热切换当前会话模型（下一轮生效）',
  '- `/model default <id>` — 写入 dsh 默认模型 agent-default-model（管理员）',
  '- `/model add|remove <provider> <modelId>` — 管理 provider 的模型（管理员）',
  '- `/providers` — 查看 dsh providers / 模型 / 凭据状态',
  '- `/provider add|update|remove <id>` — 管理 provider（管理员；deepseek-official 与自定义 pi-ai）',
  '- `/key set|remove|list <引用名>` — 管理 dsh 凭据（set/remove 需管理员）',
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
  const interrupted = await ctx.activeRuns.interrupt(ctx.scope);
  ctx.sessions.clear(ctx.scope);
  await reply(
    ctx,
    interrupted > 0 ? `已中断 ${String(interrupted)} 个任务并开始新会话。` : '已开始新会话。',
  );
}

const MAX_GROUP_NAME_LENGTH = 60;

/** Open a chat via the Feishu applink (client-side deep link). */
function groupAppLink(chatId: string): string {
  return `https://applink.feishu.cn/client/chat/open?chatId=${encodeURIComponent(chatId)}`;
}

/**
 * `/newg <群名>` — create a new group chat via the Feishu API, invite the
 * requesting user, and reply with a link. Because each scope (chat) owns an
 * independent session, chatting in the new group automatically starts a fresh
 * session there while the current session stays untouched.
 */
async function handleNewGroup(args: string, ctx: CommandContext): Promise<void> {
  const name = args.trim();
  if (!name) {
    await reply(ctx, '用法：`/newg <群名>` — 自动新建群聊并开始新会话');
    return;
  }
  if (name.length > MAX_GROUP_NAME_LENGTH) {
    await reply(
      ctx,
      `群名过长（上限 ${String(MAX_GROUP_NAME_LENGTH)} 字符，当前 ${String(name.length)}）。`,
    );
    return;
  }
  if (!ctx.channel.createChat) {
    await reply(ctx, '当前渠道不支持自动建群。');
    return;
  }
  if (!ctx.senderId) {
    await reply(ctx, '无法识别发送者 open_id，不能自动建群。');
    return;
  }
  try {
    const { chatId } = await ctx.channel.createChat({
      name,
      chatType: 'private',
      chatMode: 'group',
      inviteUserIds: [ctx.senderId],
      userIdType: 'open_id',
    });
    await reply(
      ctx,
      [
        `✅ 已创建群聊：**${name}**`,
        `- 群 ID：\`${chatId}\``,
        `- 已将你加入群聊，新会话将在群里自动开始（当前会话不受影响）`,
        '',
        `👉 [打开群聊](${groupAppLink(chatId)})`,
      ].join('\n'),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await reply(ctx, `❌ 建群失败：\`${message}\``);
  }
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
  const active = ctx.activeRuns.list(ctx.scope);
  const role = ctx.roleStore.roleForScope(ctx.scope);
  const scopeLabel =
    ctx.chatMode === 'topic' ? `${ctx.scope}（话题独立 session）` : ctx.scope;
  const runLines = active.map((run) => `  - \`${run.runId}\``);
  const roleLine = role ? `🎭 **role**: \`${role.id}\` (${role.name})` : undefined;

  await reply(
    ctx,
    [
      `🧭 **scope**: \`${scopeLabel}\``,
      `📁 **cwd**: \`${cwd}\``,
      `🔗 **session**: \`${session}\``,
      ...(roleLine ? [roleLine] : []),
      `🏃 **active runs**: ${String(active.length)}`,
      ...runLines,
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
  await reply(
    ctx,
    stopped > 0 ? `已请求终止当前 scope 的全部 ${String(stopped)} 个任务。` : '当前没有运行中的任务。',
  );
}

async function handleTimeout(args: string, ctx: CommandContext): Promise<void> {
  const input = args.trim();
  const effectiveMs = ctx.runPolicies.get(ctx.scope) ?? ctx.defaultRunTimeoutMs;

  if (!input) {
    const minutes = effectiveMs > 0 ? Math.round(effectiveMs / 60_000) : 0;
    await reply(
      ctx,
      minutes > 0
        ? `当前会话空闲超时：持续无活动事件 ${minutes} 分钟才终止。可用 \`/timeout <N|off|default>\` 调整。`
        : '当前会话空闲超时：关闭。',
    );
    return;
  }

  if (input === 'off') {
    ctx.runPolicies.set(ctx.scope, 0);
    await reply(ctx, '已关闭当前会话空闲超时。');
    return;
  }

  if (input === 'default') {
    ctx.runPolicies.clear(ctx.scope);
    await reply(ctx, '已恢复默认空闲超时。');
    return;
  }

  const minutes = Number(input);
  if (!Number.isInteger(minutes) || minutes <= 0) {
    await reply(ctx, '用法：`/timeout <N|off|default>`，N 为大于 0 的分钟数。');
    return;
  }

  ctx.runPolicies.set(ctx.scope, minutes * 60_000);
  await reply(ctx, `已设置当前会话空闲超时：持续无活动事件 ${minutes} 分钟才终止。`);
}

async function handleConcurrency(args: string, ctx: CommandContext): Promise<void> {
  const input = args.trim();
  const effective = ctx.concurrencyStore.get(ctx.scope) ?? ctx.defaultScopeConcurrency;

  if (!input) {
    await reply(
      ctx,
      `当前 scope 的并行任务数：**${String(effective)}**。可用 \`/concurrency <N|default>\` 调整（N ≥ 1）。`,
    );
    return;
  }

  if (input === 'default') {
    ctx.concurrencyStore.clear(ctx.scope);
    await reply(ctx, `已恢复默认并行任务数（${String(ctx.defaultScopeConcurrency)}）。`);
    return;
  }

  const n = Number(input);
  if (!Number.isInteger(n) || n < 1) {
    await reply(ctx, '用法：`/concurrency <N|default>`，N 为大于等于 1 的整数。');
    return;
  }

  ctx.concurrencyStore.set(ctx.scope, n);
  await reply(ctx, `已设置当前 scope 的并行任务数：**${String(n)}**。`);
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
  '/newg': handleNewGroup,
  '/cd': handleCd,
  '/ws': handleWs,
  '/status': handleStatus,
  '/resume': handleResume,
  '/stop': handleStop,
  '/timeout': handleTimeout,
  '/concurrency': handleConcurrency,
  '/role': handleRole,
  '/notify': handleNotify,
  '/retention': handleRetention,
  '/archive': handleArchive,
  '/density': handleDensity,
  '/model': handleModel,
  '/providers': handleProviders,
  '/provider': handleProvider,
  '/key': handleKey,
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
