import { resolve } from 'node:path';
import type { ActiveRuns } from '../bot/active-runs.js';
import type { ApprovalRegistry } from '../bot/approvals.js';
import type { DensityStore } from '../bot/density-store.js';
import type { PermissionPolicy, PermissionPolicyStore } from '../bot/permission-policy-store.js';
import type { NotificationPreferenceStore } from '../bot/notification-preference-store.js';
import type { ConcurrencyStore } from '../bot/concurrency-store.js';
import type { QuestionRegistry } from '../bot/questions.js';
import type { RunPolicyStore } from '../bot/run-policy.js';
import type { RetentionStore } from '../bot/retention-store.js';
import type { RoleStore } from '../bot/role-store.js';
import type { IsolationStore, ScopeIsolationMode } from '../bot/isolation-store.js';
import type { PlanApprovalRegistry } from '../bot/plan-approvals.js';
import type { AccessManager } from '../config/access-manager.js';
import type { SessionStore } from '../session/store.js';
import type { SessionArchive } from '../session/archive.js';
import type { ScopeDirectory } from '../bridge/scope-directory.js';
import type { SendOptions } from '../bridge/send-options.js';
import type { WorkspaceStore } from '../workspace/store.js';
import { renderWorkspaceCard } from '../card/workspace-card.js';
import {
  renderStatusCard,
  statusCardMarkdown,
  statusCardMarkdownEnglish,
  type StatusCardInput,
} from '../card/status-card.js';
import { parseCardDensity, type CardDensity } from '../card/density.js';
import { questionHandlerFor } from '../bridge/run-flow.js';
import type { ModelStore } from '../bot/model-store.js';
import type { WizardStore } from '../bot/wizard-store.js';
import type { DshProviderManager } from '../config/dsh-config.js';
import {
  handleKey,
  handleModel,
  handleProvider,
} from './models.js';
import {
  showConfigHub,
  type ConfigWizardContext,
} from './config-wizard.js';
import { handleArchive, handleRetention } from './archive.js';
import { handleRole } from './roles.js';
import { handleNotify } from './notify.js';
import { handleNotifications } from './notifications.js';
import { handleReplies } from './replies.js';
import type { ReplyPolicyStore } from '../bot/reply-policy-store.js';
import {
  currentVersion,
  isNewer,
  latestVersion,
  upgradeCheckEnabled,
} from '../upgrade/update-check.js';
import { reachableScopes } from '../bridge/scope-isolation.js';
import { bilingualMarkdown } from '../card/i18n.js';
import type { JobLedger, JobRecord } from '../bot/job-ledger.js';
import { redactSecrets, truncateUtf8Safe } from '../config/security.js';
import type {
  DiagnosticFile,
  DiagnosticRequestSnapshot,
} from '../diagnostics/bundle.js';
import type { SessionProjectionController } from './session-projection.js';
import type { ExecutionMode, ExecutionModeStore } from '../bot/execution-mode-store.js';
import { renderExecutionModeCard } from '../card/execution-mode-card.js';

export interface CommandChannel {
  sendMarkdown(
    chatId: string,
    markdown: string,
    options?: SendOptions,
  ): Promise<void>;
  sendCard?(chatId: string, card: object, options?: SendOptions): Promise<string | undefined>;
  updateCard?(messageId: string, card: object): Promise<void>;
  sendFile?(
    chatId: string,
    fileName: string,
    content: Buffer,
    options?: SendOptions,
  ): Promise<void>;
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
  isolationStore?: Pick<IsolationStore, 'get' | 'set'>;
  isolationMode?: ScopeIsolationMode;
  scopeDirectory: ScopeDirectory;
  archiver: SessionArchive;
  defaultRetention: number;
  archiveMax: number;
  archiveMaxAgeDays: number;
  approvals: ApprovalRegistry | undefined;
  questions: QuestionRegistry | undefined;
  plans?: PlanApprovalRegistry;
  densityStore: DensityStore | undefined;
  permissionPolicies?: PermissionPolicyStore;
  notificationPreferences?: NotificationPreferenceStore;
  replyPolicies?: ReplyPolicyStore;
  executionModes?: ExecutionModeStore;
  models: ModelStore;
  wizardStore: WizardStore;
  dshConfig: DshProviderManager;
  defaultRunTimeoutMs: number;
  defaultModel: string;
  /** Resolve role/profile/dsh/env precedence without a per-scope override. */
  resolveDefaultModel?: () => Promise<string | undefined>;
  /** Persist the admin default into the bridge profile preferences. */
  setDefaultModelPreference?: (model: string) => Promise<void>;
  senderId: string | undefined;
  accessManager: AccessManager;
  /** Verify current-chat owner/manager membership through Feishu/Lark. */
  isChatAdministrator?: (chatId: string, userId: string) => Promise<boolean>;
  channel: CommandChannel;
  defaultWorkspace: string;
  jobs?: Pick<JobLedger, 'list' | 'get' | 'counts'>;
  requeueJob?: (messageId: string, scope: string, workspaceCwd: string) => Promise<boolean>;
  createDiagnosticBundle?: (request: DiagnosticRequestSnapshot) => Promise<DiagnosticFile>;
  diagnosticTimeoutMs?: { generate: number; upload: number };
  sessionProjection?: SessionProjectionController;
}

type Handler = (args: string, ctx: CommandContext) => Promise<void>;

const DOCTOR_GENERATE_TIMEOUT_MS = 15_000;
const DOCTOR_UPLOAD_TIMEOUT_MS = 30_000;

class OperationTimeoutError extends Error {}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new OperationTimeoutError('operation timed out')), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const HELP = [
  '**dsh-lark-bot 命令**',
  '',
  '- `/new` `/reset` — 开始新会话',
  '- `/newg <群名>` — 自动新建群聊（拉你入群）并开新会话，当前会话保留',
  '- `/cd <path>` — 切换到该目录的独立会话（切回可继续）',
  '- `/ws list|save <name>|use <name>|remove <name>` — 管理工作空间',
  '- `/status` — 查看可刷新状态卡、上下文/token 用量与待处理卡',
  '- `/jobs [show <消息ID>|retry <消息ID>]` — 对账排队/运行/失败任务并显式重试',
  '- `/version` — 查看当前版本与最新版本（有新版本时提示升级）',
  '- `/doctor` — 生成脱敏诊断包并作为文件发送（管理员）',
  '- `/resume` — 查看当前会话最近上下文',
  '- `/session [current|bind <sessionId>]` — 显式选择、确认并绑定当前 workspace 的 DSH session',
  '- `/stop` — 终止当前任务',
  '- `/timeout [N|off|default]` — 查看或设置当前会话空闲超时（持续无活动事件 N 分钟才终止）',
  '- `/concurrency [N|default]` — 查看或设置当前 scope 的并行任务数',
  '- `/permission [ask|allow|deny] [scope]` — 查看或设置工具权限策略（管理员可指定当前聊天内 scope）',
  '- `/isolation [group|topic|member]` — 查看或设置本群会话隔离模式（设置仅管理员）',
  '- `/role list|show <id>|set <id>|clear` — 查看 / 绑定角色',
  '- `/role save <id> <name> [--persona 文案] [--model <id>] [--tools <csv>] [--rules 文案]` — 创建/更新角色（管理员）',
  '- `/role remove <id>` — 删除角色（管理员）',
  '- `/notify <scope|chatId> <text>` — 跨会话发送通知（管理员）',
  '- `/notify list` — 查看已注册 scope',
  '- `/notifications [show|off|on …]` — 配置当前 scope 的完成 / 失败 / 审批提醒',
  '- `/replies [show|default|set …]` — 配置回复合并、频率与近似去重（profile 管理员或当前群管理员可修改）',
  '- `/retention [N|default]` — 查看或设置当前会话保留消息条数（超出自动归档）',
  '- `/archive [note]`、`/archive send <id> [scope|chatId]`、`/archive list [N]`、`/archive clean` — 归档并上传 / 重发或转发 / 查看 / 清理',
  '- `/density [compact|standard|detailed]` — 查看或设置卡片密度',
  '- `/mode [quick|balanced|deep]` — 选择当前会话的任务执行强度（下一轮生效）',
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

const HELP_EN = [
  '**dsh-lark-bot commands**',
  '',
  '- `/new` `/reset` — start a new session',
  '- `/newg <name>` — create a group, add you, and start a separate session',
  '- `/cd <path>` — switch to that directory’s independent session',
  '- `/ws list|save <name>|use <name>|remove <name>` — manage workspaces',
  '- `/status` — open a refreshable status card with context/token usage and pending actions',
  '- `/jobs [show <message-id>|retry <message-id>]` — reconcile queued/running/failed jobs and retry explicitly',
  '- `/version` — show the installed and latest versions',
  '- `/doctor` — generate and send a redacted diagnostic bundle (admin)',
  '- `/resume` — show recent context for this session',
  '- `/session [current|bind <sessionId>]` — explicitly select, confirm, and bind a DSH session in this workspace',
  '- `/stop` — stop current tasks',
  '- `/timeout [N|off|default]` — view or set the idle timeout',
  '- `/concurrency [N|default]` — view or set parallel runs for this scope',
  '- `/permission [ask|allow|deny] [scope]` — view or set tool permission policy (admin; optional same-chat scope)',
  '- `/isolation [group|topic|member]` — view or set group isolation (admin to set)',
  '- `/role list|show <id>|set <id>|clear` — view or bind roles',
  '- `/role save <id> <name> [--persona text] [--model <id>] [--tools <csv>] [--rules text]` — create/update a role (admin)',
  '- `/role remove <id>` — remove a role (admin)',
  '- `/notify <scope|chatId> <text>` — notify another session (admin)',
  '- `/notify list` — list registered scopes',
  '- `/notifications [show|off|on …]` — configure completion / failure / approval reminders',
  '- `/replies [show|default|set …]` — configure reply batching, rate limits, and near-deduplication (profile admin or current group admin writes)',
  '- `/retention [N|default]` — view or set retained live messages',
  '- `/archive [note]`, `/archive send <id> [scope|chatId]`, `/archive list [N]`, `/archive clean` — archive and upload, resend/forward, list, or clean sessions',
  '- `/density [compact|standard|detailed]` — view or set card density',
  '- `/mode [quick|balanced|deep]` — choose this session’s task execution strength for the next turn',
  '- `/model` — view the current model and available dsh models',
  '- `/model use <id>` — hot-switch this session’s model for the next turn',
  '- `/model default <id>` — set dsh agent-default-model (admin)',
  '- `/model add|remove <provider> <modelId>` — manage provider models (admin)',
  '- `/providers` — view dsh providers, models, and credential state',
  '- `/provider add|update|remove <id>` — manage providers (admin)',
  '- `/key set|remove|list <reference>` — manage dsh credentials (set/remove require admin)',
  '- `/ask <question>` — send a structured question card and record the answer',
  '- `/invite user|admin|group <id>` — manage access allowlists',
  '- `/help` — show this help',
].join('\n');

async function reply(ctx: CommandContext, zhCn: string, enUs?: string): Promise<void> {
  await ctx.channel.sendMarkdown(ctx.chatId, enUs === undefined ? zhCn : bilingualMarkdown(zhCn, enUs), {
    replyTo: ctx.messageId,
  });
}

async function handleNew(_args: string, ctx: CommandContext): Promise<void> {
  const cwd = ctx.workspaces.cwdFor(ctx.scope) ?? ctx.defaultWorkspace;
  const interrupted = await ctx.activeRuns.interruptWorkspace(ctx.scope, cwd);
  ctx.sessions.clear(ctx.scope, cwd);
  await reply(
    ctx,
    interrupted > 0 ? `已中断 ${String(interrupted)} 个任务并开始新会话。` : '已开始新会话。',
    interrupted > 0 ? `Interrupted ${String(interrupted)} task(s) and started a new session.` : 'Started a new session.',
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
    await reply(ctx, '用法：`/newg <群名>` — 自动新建群聊并开始新会话', 'Usage: `/newg <name>` — create a group and start a new session');
    return;
  }
  if (name.length > MAX_GROUP_NAME_LENGTH) {
    await reply(
      ctx,
      `群名过长（上限 ${String(MAX_GROUP_NAME_LENGTH)} 字符，当前 ${String(name.length)}）。`,
      `The group name is too long (limit ${String(MAX_GROUP_NAME_LENGTH)} characters; received ${String(name.length)}).`,
    );
    return;
  }
  if (!ctx.channel.createChat) {
    await reply(ctx, '当前渠道不支持自动建群。', 'This channel cannot create groups automatically.');
    return;
  }
  if (!ctx.senderId) {
    await reply(ctx, '无法识别发送者 open_id，不能自动建群。', 'The sender open_id is unavailable, so the group cannot be created automatically.');
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
      [
        `✅ Created group: **${name}**`,
        `- Group ID: \`${chatId}\``,
        '- You were added to the group. A separate session starts there; this session is unchanged.',
        '',
        `👉 [Open group](${groupAppLink(chatId)})`,
      ].join('\n'),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await reply(ctx, `❌ 建群失败：\`${message}\``, `❌ Failed to create the group: \`${message}\``);
  }
}

async function handleCd(args: string, ctx: CommandContext): Promise<void> {
  const path = args.trim();
  if (!path) {
    await reply(ctx, '用法：`/cd <path>`', 'Usage: `/cd <path>`');
    return;
  }
  const cwd = resolve(path);
  const previous = ctx.workspaces.cwdFor(ctx.scope) ?? ctx.defaultWorkspace;
  const interrupted = cwd === previous
    ? 0
    : await ctx.activeRuns.interruptWorkspace(ctx.scope, previous);
  ctx.workspaces.setCwd(ctx.scope, cwd);
  await reply(
    ctx,
    `已切换工作目录：\`${cwd}\`；该工作区的会话会独立恢复。${interrupted > 0 ? `已中断原工作区 ${String(interrupted)} 个运行中任务（会话数据保留）。` : ''}`,
    `Switched workspace to \`${cwd}\`; its independent session will resume.${interrupted > 0 ? ` Interrupted ${String(interrupted)} running task(s) in the previous workspace (session data was preserved).` : ''}`,
  );
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
      [
        `Current cwd: \`${current}\``,
        '',
        ...(Object.entries(named).length > 0
          ? Object.entries(named).map(([key, value]) => `- **${key}** → \`${value}\`${value === current ? ' ← current' : ''}`)
          : ['No named workspaces.']),
      ].join('\n'),
    );
    return;
  }

  if (sub === 'save') {
    if (!name) {
      await reply(ctx, '用法：`/ws save <name>`', 'Usage: `/ws save <name>`');
      return;
    }
    const current = ctx.workspaces.cwdFor(ctx.scope) ?? ctx.defaultWorkspace;
    ctx.workspaces.saveNamed(name, current);
    await reply(ctx, `已保存工作空间：**${name}** → \`${current}\``, `Saved workspace: **${name}** → \`${current}\``);
    return;
  }

  if (sub === 'use') {
    if (!name) {
      await reply(ctx, '用法：`/ws use <name>`', 'Usage: `/ws use <name>`');
      return;
    }
    const cwd = ctx.workspaces.getNamed(name);
    if (!cwd) {
      await reply(ctx, `未找到工作空间：**${name}**`, `Workspace not found: **${name}**`);
      return;
    }
    const previous = ctx.workspaces.cwdFor(ctx.scope) ?? ctx.defaultWorkspace;
    const interrupted = cwd === previous
      ? 0
      : await ctx.activeRuns.interruptWorkspace(ctx.scope, previous);
    ctx.workspaces.setCwd(ctx.scope, cwd);
    ctx.workspaces.touchNamed(name);
    await reply(
      ctx,
      `已切换到工作空间：**${name}** → \`${cwd}\`；该工作区的会话会独立恢复。${interrupted > 0 ? `已中断原工作区 ${String(interrupted)} 个运行中任务（会话数据保留）。` : ''}`,
      `Switched to workspace **${name}** → \`${cwd}\`; its independent session will resume.${interrupted > 0 ? ` Interrupted ${String(interrupted)} running task(s) in the previous workspace (session data was preserved).` : ''}`,
    );
    return;
  }

  if (sub === 'remove') {
    if (!name) {
      await reply(ctx, '用法：`/ws remove <name>`', 'Usage: `/ws remove <name>`');
      return;
    }
    const removed = ctx.workspaces.removeNamed(name);
    await reply(ctx, removed ? `已删除工作空间：**${name}**` : `未找到工作空间：**${name}**`, removed ? `Removed workspace: **${name}**` : `Workspace not found: **${name}**`);
    return;
  }

  await reply(ctx, '未知 `/ws` 子命令，请使用 list / save / use / remove。', 'Unknown `/ws` subcommand. Use list / save / use / remove.');
}

export type StatusContext = Pick<
  CommandContext,
  | 'scope'
  | 'chatMode'
  | 'sessions'
  | 'workspaces'
  | 'activeRuns'
  | 'roleStore'
  | 'isolationMode'
  | 'approvals'
  | 'questions'
  | 'plans'
  | 'permissionPolicies'
  | 'notificationPreferences'
  | 'replyPolicies'
  | 'executionModes'
  | 'models'
  | 'dshConfig'
  | 'resolveDefaultModel'
  | 'defaultModel'
  | 'defaultWorkspace'
  | 'jobs'
  | 'sessionProjection'
>;

export async function statusCardInputFor(
  ctx: StatusContext,
): Promise<StatusCardInput> {
  const cwd = ctx.workspaces.cwdFor(ctx.scope) ?? ctx.defaultWorkspace;
  const sessionId = ctx.sessions.getRaw(ctx.scope, cwd)?.sessionId;
  const active = ctx.activeRuns.listWorkspace(ctx.scope, cwd);
  const role = ctx.roleStore.roleForScope(ctx.scope);
  const model =
    ctx.models.get(ctx.scope) ??
    await ctx.resolveDefaultModel?.() ??
    ctx.defaultModel;
  const modelIdentity = await canonicalModelIdentity(ctx.dshConfig, model);
  const storedMetrics = ctx.sessions.metricsFor(
    ctx.scope,
    cwd,
    { sessionId, model: modelIdentity },
  );
  const configuredWindow =
    storedMetrics?.contextWindow ??
    await configuredContextWindow(ctx.dshConfig, model);
  const metrics =
    storedMetrics || configuredWindow !== undefined
      ? {
          ...(storedMetrics ?? {}),
          ...(configuredWindow === undefined ? {} : { contextWindow: configuredWindow }),
        }
      : undefined;
  const pendingOwners = new Set<string>();
  if (sessionId) pendingOwners.add(sessionId);
  pendingOwners.add(`workspace:${cwd}`);
  for (const run of active) pendingOwners.add(run.runId);
  const pendingForWorkspace = (
    registry: { pendingCount(scope: string, sessionId?: string): number } | undefined,
  ): number => {
    if (!registry) return 0;
    let count = 0;
    for (const owner of pendingOwners) count += registry.pendingCount(ctx.scope, owner);
    return count;
  };
  const notificationPreference = ctx.notificationPreferences?.get(ctx.scope);
  const replyPolicy = ctx.replyPolicies?.get(ctx.scope);
  const projection = ctx.sessionProjection?.current(ctx.scope, cwd);
  return {
    scope: ctx.scope,
    cwd,
    model,
    sessionId,
    ...(projection
      ? { projection: { sessionId: projection.sessionId, lastProjectedSeq: projection.lastProjectedSeq } }
      : {}),
    activeRunIds: active.map((run) => run.runId),
    version: currentVersion(),
    isolation: ctx.chatMode === 'p2p' ? 'p2p' : (ctx.isolationMode ?? 'topic'),
    permissionPolicy: ctx.permissionPolicies?.get(ctx.scope) ?? 'ask',
    executionMode: ctx.executionModes?.get(ctx.scope) ?? 'balanced',
    ...(notificationPreference ? { notificationPreference } : {}),
    ...(replyPolicy ? { replyPolicy, replyPolicyConfigured: ctx.replyPolicies?.isConfigured(ctx.scope) ?? false } : {}),
    role: role ? `\`${role.id}\` (${role.name})` : undefined,
    metrics,
    pending: {
      approvals: pendingForWorkspace(ctx.approvals),
      questions: pendingForWorkspace(ctx.questions),
      plans: pendingForWorkspace(ctx.plans),
    },
    ...(ctx.jobs ? { jobs: ctx.jobs.counts(ctx.scope, cwd) } : {}),
  };
}

async function canonicalModelIdentity(
  dshConfig: DshProviderManager,
  model: string,
): Promise<string> {
  try {
    const route = await dshConfig.resolveModelRoute(model);
    return route ? `${route.provider}/${route.model}` : model;
  } catch {
    return model;
  }
}

async function configuredContextWindow(
  dshConfig: DshProviderManager,
  model: string,
): Promise<number | undefined> {
  try {
    const route = await dshConfig.resolveModelRoute(model);
    if (!route) return undefined;
    const provider = (await dshConfig.listProviders()).find(
      (candidate) => candidate.id === route.provider,
    );
    return provider?.models.find((candidate) => candidate.id === route.model)?.contextWindow;
  } catch {
    return undefined;
  }
}

async function handleStatus(_args: string, ctx: CommandContext): Promise<void> {
  const input = await statusCardInputFor(ctx);

  if (ctx.channel.sendCard) {
    try {
      await ctx.channel.sendCard(ctx.chatId, renderStatusCard(input), {
        replyTo: ctx.messageId,
      });
      return;
    } catch {
      // Older clients / tenants may reject Card JSON 2.0; preserve the same
      // truthful snapshot as Markdown instead of failing the command.
    }
  }
  await reply(ctx, bilingualMarkdown(statusCardMarkdown(input), statusCardMarkdownEnglish(input)));
}

async function handleIsolation(args: string, ctx: CommandContext): Promise<void> {
  if (ctx.chatMode === 'p2p') {
    await reply(ctx, '当前是私聊，scope 已按会话天然隔离，无需设置。', 'This is a direct chat; its scope is already isolated, so no setting is needed.');
    return;
  }
  const mode = args.trim().toLowerCase();
  if (!mode) {
    await reply(
      ctx,
      `当前群会话隔离模式：**${ctx.isolationStore?.get(ctx.chatId) ?? 'topic'}**。可用 \`/isolation group|topic|member\` 切换。`,
      `Current group isolation mode: **${ctx.isolationStore?.get(ctx.chatId) ?? 'topic'}**. Use \`/isolation group|topic|member\` to switch.`,
    );
    return;
  }
  if (mode !== 'group' && mode !== 'topic' && mode !== 'member') {
    await reply(ctx, '用法：`/isolation group|topic|member`', 'Usage: `/isolation group|topic|member`');
    return;
  }
  if (!requireAdmin(ctx)) return;
  if (!ctx.isolationStore) {
    await reply(ctx, '当前运行环境未启用群聊隔离策略存储。', 'Group isolation policy storage is not enabled in this runtime.');
    return;
  }
  ctx.isolationStore.set(ctx.chatId, mode);
  await reply(
    ctx,
    `已将本群隔离模式设为 **${mode}**，从下一条消息起生效。已有 group / topic / member scope 与会话数据均保留，切回后可继续使用。`,
    `Set this group’s isolation mode to **${mode}**. It takes effect on the next message; existing group/topic/member scopes and session data are preserved.`,
  );
}

async function handleVersion(_args: string, ctx: CommandContext): Promise<void> {
  const current = currentVersion();
  const lines = [`🔖 **版本**: \`${current}\``];
  const english = [`🔖 **Version**: \`${current}\``];
  try {
    const latest = await latestVersion();
    if (latest !== undefined) {
      lines.push(
        isNewer(latest, current)
          ? `⬆️ **最新**: \`${latest}\` — 有新版本；管理员可执行 \`dsh-lark-bot upgrade\` 一键更新`
          : `✅ **最新**: \`${latest}\`（已是最新）`,
      );
      english.push(
        isNewer(latest, current)
          ? `⬆️ **Latest**: \`${latest}\` — an update is available; an admin can run \`dsh-lark-bot upgrade\``
          : `✅ **Latest**: \`${latest}\` (up to date)`,
      );
    } else if (upgradeCheckEnabled()) {
      lines.push('最新版本查询暂不可用（网络 / registry 异常）。');
      english.push('Latest-version lookup is unavailable (network or registry error).');
    }
  } catch {
    lines.push('最新版本查询暂不可用（网络 / registry 异常）。');
    english.push('Latest-version lookup is unavailable (network or registry error).');
  }
  await reply(ctx, lines.join('\n'), english.join('\n'));
}

async function handleDoctor(_args: string, ctx: CommandContext): Promise<void> {
  if (!requireAdmin(ctx)) return;
  if (!ctx.createDiagnosticBundle || !ctx.channel.sendFile) {
    await reply(ctx, '当前渠道不支持生成或发送诊断文件。', 'Diagnostic generation or file delivery is unavailable in this channel.');
    return;
  }
  let file: DiagnosticFile;
  try {
    const status = await statusCardInputFor(ctx);
    file = await withTimeout(ctx.createDiagnosticBundle({
      scope: ctx.scope,
      chatMode: ctx.chatMode,
      workspace: status.cwd,
      model: status.model,
      ...(status.sessionId ? { sessionId: status.sessionId } : {}),
      activeRunIds: status.activeRunIds,
      pending: status.pending,
      ...(status.jobs ? { jobs: status.jobs } : {}),
    }), ctx.diagnosticTimeoutMs?.generate ?? DOCTOR_GENERATE_TIMEOUT_MS);
  } catch {
    await reply(
      ctx,
      '⚠️ 诊断包生成失败。请稍后重试；若持续失败，请在本机运行 `dsh-lark-bot doctor`。',
      '⚠️ Failed to generate the diagnostic bundle. Retry later; if it keeps failing, run `dsh-lark-bot doctor` locally.',
    );
    return;
  }
  try {
    await withTimeout(ctx.channel.sendFile(ctx.chatId, file.fileName, file.content, {
      replyTo: ctx.messageId,
      ...(ctx.threadId ? { threadId: ctx.threadId } : {}),
    }), ctx.diagnosticTimeoutMs?.upload ?? DOCTOR_UPLOAD_TIMEOUT_MS);
  } catch (error) {
    if (error instanceof OperationTimeoutError) {
      await reply(
        ctx,
        '⚠️ 诊断包上传等待超时，结果未知：文件仍可能稍后到达。请先检查当前聊天，不要立即重试。',
        '⚠️ Diagnostic upload timed out with an unknown result: the file may still arrive later. Check this chat before retrying.',
      );
      return;
    }
    await reply(
      ctx,
      '⚠️ 诊断包发送失败。请稍后重试；若持续失败，请在本机运行 `dsh-lark-bot doctor`。',
      '⚠️ Failed to send the diagnostic bundle. Retry later; if it keeps failing, run `dsh-lark-bot doctor` locally.',
    );
    return;
  }
  await reply(
    ctx,
    '✅ 脱敏诊断包已生成并发送，可直接下载转发给维护者。',
    '✅ The redacted diagnostic bundle was generated and sent. You can download and forward it to a maintainer.',
  ).catch(() => undefined);
}

async function handleResume(_args: string, ctx: CommandContext): Promise<void> {
  const cwd = ctx.workspaces.cwdFor(ctx.scope) ?? ctx.defaultWorkspace;
  const history = ctx.sessions.historyFor(ctx.scope, cwd);
  if (history.length === 0) {
    await reply(ctx, '当前会话没有历史上下文。', 'This session has no conversation history.');
    return;
  }

  const recent = history.slice(-6).map((message) => {
    const speaker = message.role === 'user' ? '👤' : '🤖';
    return `${speaker} ${message.content.slice(0, 300)}`;
  });

  await reply(ctx, [`当前 scope：\`${ctx.scope}\``, '', ...recent].join('\n'), [`Current scope: \`${ctx.scope}\``, '', ...recent].join('\n'));
}

async function handleJobs(args: string, ctx: CommandContext): Promise<void> {
  if (!ctx.jobs) {
    await reply(ctx, '当前运行环境未启用持久任务账本。', 'The durable job ledger is not enabled in this runtime.');
    return;
  }
  const cwd = ctx.workspaces.cwdFor(ctx.scope) ?? ctx.defaultWorkspace;
  const [sub, id] = args.trim().split(/\s+/, 2);
  const records = ctx.jobs.list(ctx.scope, cwd, 20);

  if (sub === 'retry') {
    if (!id) {
      await reply(ctx, '用法：`/jobs retry <消息ID>`', 'Usage: `/jobs retry <message-id>`');
      return;
    }
    const queued = await ctx.requeueJob?.(id, ctx.scope, cwd);
    await reply(
      ctx,
      queued
        ? `♻️ 已将任务 **${id}** 重新入队。重复执行可能重复外部副作用，请留意原任务 checkpoint。`
        : `无法重试 **${id}**：只允许重试当前 workspace 内的 failed / interrupted 任务。`,
      queued
        ? `♻️ Requeued job **${id}**. Retrying may repeat external side effects; review the original checkpoint.`
        : `Cannot retry **${id}**: only failed or interrupted jobs in the current workspace are eligible.`,
    );
    return;
  }

  if (sub === 'show') {
    const record = id ? ctx.jobs.get(id, ctx.scope, cwd) : undefined;
    if (!record) {
      await reply(ctx, `当前 workspace 未找到任务：**${id ?? ''}**`, `Job not found in this workspace: **${id ?? ''}**`);
      return;
    }
    await reply(ctx, jobDetail(record, 'zh'), jobDetail(record, 'en'));
    return;
  }

  if (sub && sub !== 'list') {
    await reply(ctx, '用法：`/jobs [list|show <消息ID>|retry <消息ID>]`', 'Usage: `/jobs [list|show <message-id>|retry <message-id>]`');
    return;
  }

  const counts = ctx.jobs.counts(ctx.scope, cwd);
  const rows = records.slice(0, 10);
  await reply(
    ctx,
    [
      '**任务对账**',
      `- queued ${counts.queued} · running ${counts.running} · interrupted ${counts.interrupted} · failed ${counts.failed} · completed ${counts.completed}`,
      '',
      ...(rows.length > 0 ? rows.map((record) => jobLine(record, 'zh')) : ['暂无任务记录。']),
      '',
      '用 `/jobs show <消息ID>` 查看 checkpoint；只对 failed / interrupted 使用 `/jobs retry <消息ID>`。',
    ].join('\n'),
    [
      '**Job reconciliation**',
      `- queued ${counts.queued} · running ${counts.running} · interrupted ${counts.interrupted} · failed ${counts.failed} · completed ${counts.completed}`,
      '',
      ...(rows.length > 0 ? rows.map((record) => jobLine(record, 'en')) : ['No job records.']),
      '',
      'Use `/jobs show <message-id>` for its checkpoint; `/jobs retry <message-id>` is limited to failed/interrupted jobs.',
    ].join('\n'),
  );
}

function jobLine(record: JobRecord, locale: 'zh' | 'en'): string {
  const preview = jobPreview(record.message.content);
  const stage = jobPreview(record.checkpoint?.detail ?? record.checkpoint?.stage ?? '-');
  return locale === 'zh'
    ? `- **${record.message.messageId}** · **${record.state}** · ${stage} · ${preview}`
    : `- **${record.message.messageId}** · **${record.state}** · ${stage} · ${preview}`;
}

function jobDetail(record: JobRecord, locale: 'zh' | 'en'): string {
  const lines = locale === 'zh'
    ? ['**任务详情**', `- 消息 ID：\`${record.message.messageId}\``, `- 状态：**${record.state}**`, `- 尝试次数：${record.attempts}`]
    : ['**Job details**', `- Message ID: \`${record.message.messageId}\``, `- State: **${record.state}**`, `- Attempts: ${record.attempts}`];
  if (record.runId) lines.push(`- run: \`${record.runId}\``);
  if (record.checkpoint) {
    lines.push(`- checkpoint: **${record.checkpoint.stage}**${record.checkpoint.detail ? ` · ${jobPreview(record.checkpoint.detail)}` : ''}`);
  }
  if (record.error) lines.push(`- ${locale === 'zh' ? '错误' : 'Error'}: ${jobPreview(record.error)}`);
  lines.push('', `${locale === 'zh' ? '消息摘要' : 'Message preview'}: ${jobPreview(record.message.content)}`);
  return lines.join('\n');
}

function jobPreview(text: string): string {
  return truncateUtf8Safe(redactSecrets(text), 240)
    .replaceAll('`', '\\`')
    .replaceAll(/\s+/gu, ' ');
}

async function handleStop(_args: string, ctx: CommandContext): Promise<void> {
  const scopes = reachableScopes({
    chatId: ctx.chatId,
    chatMode: ctx.chatMode,
    ...(ctx.threadId ? { threadId: ctx.threadId } : {}),
    ...(ctx.senderId ? { senderId: ctx.senderId } : {}),
  });
  let stopped = 0;
  for (const scope of scopes) stopped += await ctx.activeRuns.interrupt(scope);
  await reply(
    ctx,
    stopped > 0
      ? `已请求终止当前及切换前隔离 scope 的全部 ${String(stopped)} 个任务。`
      : '当前及切换前隔离 scope 均没有运行中的任务。',
    stopped > 0
      ? `Requested termination of all ${String(stopped)} task(s) in the current and previously selected isolation scopes.`
      : 'No tasks are running in the current or previously selected isolation scopes.',
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
      minutes > 0
        ? `Session idle timeout: stop after ${minutes} minutes without activity events. Use \`/timeout <N|off|default>\` to change it.`
        : 'Session idle timeout: off.',
    );
    return;
  }

  if (input === 'off') {
    ctx.runPolicies.set(ctx.scope, 0);
    await reply(ctx, '已关闭当前会话空闲超时。', 'Disabled the session idle timeout.');
    return;
  }

  if (input === 'default') {
    ctx.runPolicies.clear(ctx.scope);
    await reply(ctx, '已恢复默认空闲超时。', 'Restored the default idle timeout.');
    return;
  }

  const minutes = Number(input);
  if (!Number.isInteger(minutes) || minutes <= 0) {
    await reply(ctx, '用法：`/timeout <N|off|default>`，N 为大于 0 的分钟数。', 'Usage: `/timeout <N|off|default>`, where N is a positive number of minutes.');
    return;
  }

  ctx.runPolicies.set(ctx.scope, minutes * 60_000);
  await reply(ctx, `已设置当前会话空闲超时：持续无活动事件 ${minutes} 分钟才终止。`, `Set the session idle timeout to ${minutes} minutes without activity events.`);
}

async function handleConcurrency(args: string, ctx: CommandContext): Promise<void> {
  const input = args.trim();
  const effective = ctx.concurrencyStore.get(ctx.scope) ?? ctx.defaultScopeConcurrency;

  if (!input) {
    await reply(
      ctx,
      `当前 scope 的并行任务数：**${String(effective)}**。可用 \`/concurrency <N|default>\` 调整（N ≥ 1）。`,
      `Parallel tasks for this scope: **${String(effective)}**. Use \`/concurrency <N|default>\` to change it (N ≥ 1).`,
    );
    return;
  }

  if (input === 'default') {
    ctx.concurrencyStore.clear(ctx.scope);
    await reply(ctx, `已恢复默认并行任务数（${String(ctx.defaultScopeConcurrency)}）。`, `Restored the default parallel-task limit (${String(ctx.defaultScopeConcurrency)}).`);
    return;
  }

  const n = Number(input);
  if (!Number.isInteger(n) || n < 1) {
    await reply(ctx, '用法：`/concurrency <N|default>`，N 为大于等于 1 的整数。', 'Usage: `/concurrency <N|default>`, where N is an integer of at least 1.');
    return;
  }

  ctx.concurrencyStore.set(ctx.scope, n);
  await reply(ctx, `已设置当前 scope 的并行任务数：**${String(n)}**。`, `Set parallel tasks for this scope to **${String(n)}**.`);
}

async function handlePermission(args: string, ctx: CommandContext): Promise<void> {
  const [rawPolicy = '', rawTarget = '', ...extra] = args.trim().split(/\s+/);
  const input = rawPolicy.toLowerCase();
  const labels: Record<PermissionPolicy, { zh: string; en: string }> = {
    ask: { zh: '每次询问', en: 'ask every time' },
    allow: { zh: '自动放行', en: 'auto-allow' },
    deny: { zh: '直接拒绝', en: 'always deny' },
  };
  if (!input) {
    const current = ctx.permissionPolicies?.get(ctx.scope) ?? 'ask';
    await reply(
      ctx,
      `当前 scope 的工具权限策略：**${labels[current].zh}**（\`${current}\`）。可用 \`/permission ask|allow|deny\` 调整（仅管理员）。`,
      `Tool permission policy for this scope: **${labels[current].en}** (\`${current}\`). Use \`/permission ask|allow|deny\` to change it (admin only).`,
    );
    return;
  }
  if ((input !== 'ask' && input !== 'allow' && input !== 'deny') || extra.length > 0) {
    await reply(ctx, '用法：`/permission [ask|allow|deny] [scope]`', 'Usage: `/permission [ask|allow|deny] [scope]`');
    return;
  }
  if (!requireAdmin(ctx)) return;
  if (!ctx.permissionPolicies) {
    await reply(ctx, '当前运行环境未启用工具权限策略存储。', 'Tool permission policy storage is not enabled in this runtime.');
    return;
  }
  const targetScope = rawTarget || ctx.scope;
  if (
    targetScope !== ctx.chatId &&
    !targetScope.startsWith(`${ctx.chatId}:`)
  ) {
    await reply(ctx, '只能修改当前聊天内的 scope。请从目标会话 `/status` 复制完整 scope。', 'You can only modify a scope in the current chat. Copy the full scope from the target session’s `/status`.');
    return;
  }
  await ctx.permissionPolicies.set(targetScope, input);
  await reply(
    ctx,
    `已将 scope \`${targetScope}\` 的工具权限策略设为 **${labels[input].zh}**（\`${input}\`），从下一次工具审批起生效。计划审批仍会照常执行。`,
    `Set scope \`${targetScope}\`'s tool permission policy to **${labels[input].en}** (\`${input}\`). It applies to the next tool approval; plan approval remains enforced.`,
  );
}

async function handleDensity(args: string, ctx: CommandContext): Promise<void> {
  const input = args.trim().toLowerCase();
  if (!input) {
    const current = ctx.densityStore?.get(ctx.scope) ?? 'standard';
    await reply(
      ctx,
      `当前卡片密度：**${current}**。可用 \`/density compact|standard|detailed\` 调整。`,
      `Current card density: **${current}**. Use \`/density compact|standard|detailed\` to change it.`,
    );
    return;
  }
  if (input === 'default') {
    ctx.densityStore?.clear(ctx.scope);
    await reply(ctx, '已恢复默认卡片密度。', 'Restored the default card density.');
    return;
  }
  const density: CardDensity | undefined = parseCardDensity(input);
  if (!density) {
    await reply(ctx, '用法：`/density [compact|standard|detailed|default]`', 'Usage: `/density [compact|standard|detailed|default]`');
    return;
  }
  ctx.densityStore?.set(ctx.scope, density);
  await reply(ctx, `已设置当前会话卡片密度：**${density}**。`, `Set this session’s card density to **${density}**.`);
}

async function handleExecutionMode(args: string, ctx: CommandContext): Promise<void> {
  const input = args.trim().toLowerCase();
  if (!ctx.executionModes) {
    await reply(ctx, '当前运行环境未启用执行模式存储。', 'Execution mode storage is unavailable in this runtime.');
    return;
  }
  if (!input) {
    const current = ctx.executionModes.get(ctx.scope);
    const actorId = ctx.senderId;
    if (ctx.channel.sendCard && actorId) {
      try {
        await ctx.channel.sendCard(ctx.chatId, renderExecutionModeCard({
          scope: ctx.scope,
          current,
          actorId,
        }), { replyTo: ctx.messageId, ...(ctx.threadId ? { threadId: ctx.threadId } : {}) });
        return;
      } catch {
        // Preserve a complete text path when interactive cards are unavailable.
      }
    }
    await reply(ctx,
      `当前执行模式：**${current}**。可用 \`/mode quick|balanced|deep\` 切换；下一轮生效。`,
      `Current execution mode: **${current}**. Use \`/mode quick|balanced|deep\`; changes apply next turn.`);
    return;
  }
  if (input !== 'quick' && input !== 'balanced' && input !== 'deep') {
    await reply(ctx, '用法：`/mode [quick|balanced|deep]`', 'Usage: `/mode [quick|balanced|deep]`');
    return;
  }
  await ctx.executionModes.set(ctx.scope, input as ExecutionMode);
  await reply(ctx,
    `已将当前会话执行模式设为 **${input}**，从下一轮生效；正在运行的任务与现有上下文不受影响。`,
    `Set this session’s execution mode to **${input}** for the next turn. Active work and existing context are unchanged.`);
}

async function handleAsk(args: string, ctx: CommandContext): Promise<void> {
  const question = args.trim();
  if (!question) {
    await reply(ctx, '用法：`/ask <问题>`', 'Usage: `/ask <question>`');
    return;
  }
  if (!ctx.questions) {
    await reply(ctx, '问答卡未启用（请确认 questions 已接线）。', 'Question cards are disabled (check the questions integration).');
    return;
  }
  const cwd = ctx.workspaces.cwdFor(ctx.scope) ?? ctx.defaultWorkspace;
  const answer = await questionHandlerFor({
    questions: ctx.questions,
    channel: ctx.channel,
    chatId: ctx.chatId,
    scope: ctx.scope,
    ownerSessionId: ctx.sessions.getRaw(ctx.scope, cwd)?.sessionId ?? `workspace:${cwd}`,
    sendOptions: {
      replyTo: ctx.messageId,
      ...(ctx.threadId ? { threadId: ctx.threadId } : {}),
    },
  })({
    kind: 'text',
    question,
    id: '',
  });
  if (answer !== undefined) {
    const text = Array.isArray(answer) ? answer.join('、') : answer;
    // The question belongs to the workspace selected when its card was sent.
    // A later /cd must not redirect the answer into another project's history.
    ctx.sessions.recordExchange(ctx.scope, cwd, [text], undefined);
    await reply(ctx, '已记录你的回答，并写入会话上下文。', 'Recorded your answer in the session context.');
  } else {
    await reply(ctx, '未收到回答（卡片可能已超时或被忽略）。', 'No answer was received (the card may have expired or been ignored).');
  }
}

async function handleInvite(args: string, ctx: CommandContext): Promise<void> {
  const [kind, ...rest] = args.trim().split(/\s+/);
  const id = rest.join(' ').trim();

  // `/invite list` 为只读，保持开放；其余均为白名单写操作，仅管理员可执行
  // （首个扫码绑定的 operator 自动成为管理员）。未鉴权时 `/invite admin <自己的
  // open_id>` 即可自我提权并解锁 /key set、/provider、/notify，因此写操作必须
  // 与其他特权命令（/role、/notify、/model、/provider、/key）使用同一守卫。
  if (kind !== 'list' && !requireAdmin(ctx)) return;

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
      [
        '**Access allowlists**',
        `users: ${snapshot.allowedUsers.join(', ') || '(empty)'}`,
        `chats: ${snapshot.allowedChats.join(', ') || '(empty)'}`,
        `admins: ${snapshot.admins.join(', ') || '(empty)'}`,
      ].join('\n'),
    );
    return;
  }

  if (!kind || !id) {
    await reply(
      ctx,
      '用法：`/invite user|admin|group <id>`、`/invite list`、`/invite remove user|group <id>`',
      'Usage: `/invite user|admin|group <id>`, `/invite list`, or `/invite remove user|group <id>`',
    );
    return;
  }

  if (kind === 'user') {
    await ctx.accessManager.addUser(id);
    await reply(ctx, `已允许用户：\`${id}\``, `Allowed user: \`${id}\``);
    return;
  }

  if (kind === 'admin') {
    await ctx.accessManager.addAdmin(id);
    await reply(ctx, `已设为管理员：\`${id}\``, `Granted admin access to: \`${id}\``);
    return;
  }

  if (kind === 'group') {
    await ctx.accessManager.addChat(id);
    await reply(ctx, `已允许群聊：\`${id}\``, `Allowed group chat: \`${id}\``);
    return;
  }

  if (kind === 'remove') {
    const [sub, target] = rest;
    if (sub === 'user' && target) {
      await ctx.accessManager.removeUser(target);
      await reply(ctx, `已移除用户：\`${target}\``, `Removed user: \`${target}\``);
      return;
    }
    if (sub === 'group' && target) {
      await ctx.accessManager.removeChat(target);
      await reply(ctx, `已移除群聊：\`${target}\``, `Removed group chat: \`${target}\``);
      return;
    }
    await reply(ctx, '用法：`/invite remove user <id>` 或 `/invite remove group <chatId>`', 'Usage: `/invite remove user <id>` or `/invite remove group <chatId>`');
    return;
  }

  await reply(ctx, '未知 `/invite` 类型，请使用 user / admin / group / list / remove。', 'Unknown `/invite` type. Use user / admin / group / list / remove.');
}

function requireAdmin(ctx: CommandContext): boolean {
  if (!ctx.accessManager.isAdmin(ctx.senderId)) {
    void reply(ctx, '仅管理员可执行该操作。', 'Only admins can perform this operation.');
    return false;
  }
  return true;
}

/** Build the interactive config-wizard context from a command context. */
function wizardContext(ctx: CommandContext): ConfigWizardContext {
  return {
    scope: ctx.scope,
    chatId: ctx.chatId,
    senderId: ctx.senderId ?? '',
    channel: ctx.channel,
    dshConfig: ctx.dshConfig,
    accessManager: ctx.accessManager,
    models: ctx.models,
    wizards: ctx.wizardStore,
    defaultModel: ctx.defaultModel,
    ...(ctx.resolveDefaultModel ? { resolveDefaultModel: ctx.resolveDefaultModel } : {}),
  };
}

/** `/providers` and bare `/provider` open the interactive management hub. */
async function handleConfigHub(_args: string, ctx: CommandContext): Promise<void> {
  await showConfigHub(wizardContext(ctx));
}

/** Bare `/provider` opens the hub; subcommands keep the text interface. */
async function handleProviderDispatch(args: string, ctx: CommandContext): Promise<void> {
  if (!args.trim()) {
    await handleConfigHub(args, ctx);
    return;
  }
  await handleProvider(args, ctx);
}

/** Bare `/model` opens the hub; subcommands keep the text interface. */
async function handleModelDispatch(args: string, ctx: CommandContext): Promise<void> {
  if (!args.trim()) {
    await handleConfigHub(args, ctx);
    return;
  }
  await handleModel(args, ctx);
}

/** Bare `/key` opens the hub; subcommands keep the text interface. */
async function handleKeyDispatch(args: string, ctx: CommandContext): Promise<void> {
  if (!args.trim()) {
    await handleConfigHub(args, ctx);
    return;
  }
  await handleKey(args, ctx);
}

async function handleHelp(_args: string, ctx: CommandContext): Promise<void> {
  await reply(ctx, HELP, HELP_EN);
}

async function handleSessionProjection(args: string, ctx: CommandContext): Promise<void> {
  if (!ctx.sessionProjection) {
    await reply(
      ctx,
      '当前 adapter 未提供 DSH session 投影；请使用 `web` adapter 并确认 Web host 可用。',
      'The current adapter does not provide DSH session projection; use the `web` adapter and ensure the Web host is reachable.',
    );
    return;
  }
  await ctx.sessionProjection.handleCommand(args, ctx);
}

const handlers: Record<string, Handler> = {
  '/new': handleNew,
  '/reset': handleNew,
  '/newg': handleNewGroup,
  '/cd': handleCd,
  '/ws': handleWs,
  '/status': handleStatus,
  '/jobs': handleJobs,
  '/version': handleVersion,
  '/doctor': handleDoctor,
  '/resume': handleResume,
  '/session': handleSessionProjection,
  '/stop': handleStop,
  '/timeout': handleTimeout,
  '/concurrency': handleConcurrency,
  '/permission': handlePermission,
  '/isolation': handleIsolation,
  '/role': handleRole,
  '/notify': handleNotify,
  '/notifications': handleNotifications,
  '/replies': handleReplies,
  '/retention': handleRetention,
  '/archive': handleArchive,
  '/density': handleDensity,
  '/mode': handleExecutionMode,
  '/effort': handleExecutionMode,
  '/model': handleModelDispatch,
  '/providers': handleConfigHub,
  '/provider': handleProviderDispatch,
  '/key': handleKeyDispatch,
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
