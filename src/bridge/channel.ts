import { createLarkChannel, type LarkChannel, type NormalizedMessage } from '@larksuite/channel';
import type { AgentAdapter } from '../adapters/types.js';
import type { ActiveRuns } from '../bot/active-runs.js';
import type { ApprovalRegistry } from '../bot/approvals.js';
import type { DensityStore } from '../bot/density-store.js';
import type { ConcurrencyStore } from '../bot/concurrency-store.js';
import type { ModelStore } from '../bot/model-store.js';
import type { PendingQueue } from '../bot/pending-queue.js';
import type { QuestionRegistry } from '../bot/questions.js';
import type { RetentionStore } from '../bot/retention-store.js';
import type { RoleStore } from '../bot/role-store.js';
import type { RunPolicyStore } from '../bot/run-policy.js';
import type { WizardStore } from '../bot/wizard-store.js';
import type { IsolationStore } from '../bot/isolation-store.js';
import type { PlanApprovalRegistry } from '../bot/plan-approvals.js';
import {
  statusCardInputFor,
  tryHandleCommand,
  type CommandChannel,
} from '../commands/index.js';
import { renderStatusCard } from '../card/status-card.js';
import {
  handleConfigHubAction,
  handleWizardCardAction,
  type ConfigWizardContext,
} from '../commands/config-wizard.js';
import { extractQuestionAnswer } from '../card/question-card.js';
import type { AccessManager } from '../config/access-manager.js';
import type { DshProviderManager } from '../config/dsh-config.js';
import { isEventFresh } from '../config/security.js';
import { log } from '../core/logger.js';
import { bilingualMarkdown } from '../card/i18n.js';
import type { SessionStore } from '../session/store.js';
import type { SessionArchive } from '../session/archive.js';
import type { WorkspaceStore } from '../workspace/store.js';
import { adaptLarkChannel } from './lark-channel.js';
import {
  GroupMessagePoller,
  type GroupHistorySource,
} from './group-message-poller.js';
import type { ScopeDirectory } from './scope-directory.js';
import { isolatedScope, memberOwnerForScope } from './scope-isolation.js';
import { ReconnectNotifier } from './reconnect-notifier.js';
import type { BotHandoffGuard } from '../bot/handoff-guard.js';
import type { DurableQueuedMessage, JobLedger } from '../bot/job-ledger.js';
import type { DiagnosticFile, DiagnosticRequestSnapshot } from '../diagnostics/bundle.js';
import type { PermissionPolicyStore } from '../bot/permission-policy-store.js';
import type { NotificationPreference, NotificationPreferenceStore } from '../bot/notification-preference-store.js';
import type { ReplyPolicyStore } from '../bot/reply-policy-store.js';
import type { SessionProjectionStore } from '../session/projection-store.js';
import type { SessionProjectionSource } from '../session/projection-protocol.js';
import {
  SessionProjectionBridge,
  type SessionProjectionLimits,
} from '../session/projection-bridge.js';
import { SessionProjectionController } from '../commands/session-projection.js';
import type { ExecutionModeStore } from '../bot/execution-mode-store.js';

export type QueuedMessage = NormalizedMessage & { workspaceCwd: string };

export interface StartChannelDeps {
  appId: string;
  appSecret: string;
  tenant: 'feishu' | 'lark';
  adapter: AgentAdapter;
  sessions: SessionStore;
  workspaces: WorkspaceStore;
  activeRuns: ActiveRuns;
  runPolicies: RunPolicyStore;
  concurrencyStore: ConcurrencyStore;
  defaultScopeConcurrency: number;
  retentionStore: RetentionStore;
  roleStore: RoleStore;
  isolationStore?: IsolationStore;
  scopeDirectory?: ScopeDirectory;
  archiver: SessionArchive;
  defaultRetention: number;
  archiveMax: number;
  archiveMaxAgeDays: number;
  defaultRunTimeoutMs: number;
  accessManager: AccessManager;
  pending: PendingQueue<QueuedMessage>;
  approvals?: ApprovalRegistry;
  questions?: QuestionRegistry;
  plans?: PlanApprovalRegistry;
  densityStore?: DensityStore;
  permissionPolicies?: PermissionPolicyStore;
  notificationPreferences?: NotificationPreferenceStore;
  defaultNotificationPreference?: NotificationPreference;
  replyPolicies?: ReplyPolicyStore;
  executionModes?: ExecutionModeStore;
  models: ModelStore;
  wizardStore: WizardStore;
  dshConfig: DshProviderManager;
  defaultWorkspace: string;
  defaultModel: string;
  /** Resolve role/profile/dsh/env precedence without a per-scope override. */
  resolveDefaultModel?: (scope: string) => Promise<string | undefined>;
  /**
   * Persist the admin-chosen default model into the bridge profile
   * preferences so new sessions honor `/model default` even when a profile
   * preference currently shadows dsh's agent-default-model.
   */
  setDefaultModelPreference?: (model: string) => Promise<void>;
  allowedUsers?: string[];
  allowedChats?: string[];
  accessDefaultDeny?: boolean;
  eventFreshnessMs?: number;
  groupNoAt?: boolean;
  groupPollMs?: number;
  /** Trusted fleet lookup for inbound bot-to-bot @ handoffs. */
  isTrustedBot?: (openId: string) => Promise<boolean>;
  botHandoffMax?: number;
  handoffGuard?: Pick<BotHandoffGuard, 'recordHuman' | 'recordBot'>;
  jobs?: JobLedger;
  /** Injectable history source for deterministic tests. */
  groupHistorySource?: GroupHistorySource;
  createDiagnosticBundle?: (request: DiagnosticRequestSnapshot) => Promise<DiagnosticFile>;
  stopGraceMs?: number;
  createChannel?: typeof createLarkChannel;
  sessionProjectionStore?: SessionProjectionStore;
  sessionProjectionSource?: SessionProjectionSource;
  sessionProjectionLimits?: SessionProjectionLimits;
}

export interface BridgeChannel {
  channel: LarkChannel;
  disconnect(): Promise<void>;
}

export async function startChannel(deps: StartChannelDeps): Promise<BridgeChannel> {
  const channel = (deps.createChannel ?? createLarkChannel)({
    appId: deps.appId,
    appSecret: deps.appSecret,
    domain:
      deps.tenant === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn',
    source: 'dsh-lark-bot',
    policy: {
      dmMode: deps.allowedUsers?.length
        ? 'allowlist'
        : deps.accessDefaultDeny === true
          ? 'disabled'
          : 'open',
      // Reply-to-question messages in groups intentionally do not require an
      // @mention. The bridge applies the normal mention gate after it has had
      // a chance to match the replied card message id.
      requireMention: false,
      respondToMentionAll: false,
      ...(deps.allowedUsers ? { dmAllowlist: deps.allowedUsers } : {}),
      ...(deps.allowedChats ? { groupAllowlist: deps.allowedChats } : {}),
    },
    safety: {
      chatQueue: { enabled: false },
    },
    outbound: {
      streamThrottleMs: 400,
    },
    includeRawEvent: true,
    resolveChatMode: true,
    handshakeTimeoutMs: 8_000,
    httpTimeoutMs: 30_000,
    respectProxyEnv: true,
  });

  const streaming = adaptLarkChannel(channel);
  const commandChannel: CommandChannel = streaming;
  const sessionProjectionBridge = deps.sessionProjectionStore && deps.sessionProjectionSource && deps.scopeDirectory
    ? new SessionProjectionBridge({
        source: deps.sessionProjectionSource,
        store: deps.sessionProjectionStore,
        channel: commandChannel,
        limits: deps.sessionProjectionLimits ?? {
          backfillMessages: 20,
          backfillBytes: 64 * 1024,
          historyPageMessages: 100,
          streamUpdateMs: 800,
          reconnectMs: 5_000,
        },
      })
    : undefined;
  const sessionProjection = sessionProjectionBridge && deps.sessionProjectionStore && deps.scopeDirectory
    ? new SessionProjectionController({
        bridge: sessionProjectionBridge,
        store: deps.sessionProjectionStore,
        sessions: deps.sessions,
        scopes: deps.scopeDirectory,
        access: deps.accessManager,
        channel: commandChannel,
      })
    : undefined;
  sessionProjection?.rehydrateSessionMappings();
  const reconnectNotifier = new ReconnectNotifier(
    commandChannel,
    deps.scopeDirectory,
    Date.now,
    deps.jobs
      ? (scope) => {
          const cwd = deps.workspaces.cwdFor(scope) ?? deps.defaultWorkspace;
          const counts = deps.jobs!.counts(scope, cwd);
          return {
            zhCn: `账本对账：queued ${counts.queued} · running ${counts.running} · interrupted ${counts.interrupted} · failed ${counts.failed}；详情见 \`/jobs\`。`,
            enUs: `Ledger reconciliation: queued ${counts.queued} · running ${counts.running} · interrupted ${counts.interrupted} · failed ${counts.failed}; use \`/jobs\` for details.`,
          };
        }
      : undefined,
  );
  const isolationStore = deps.isolationStore ?? EMPTY_ISOLATION_STORE;
  let groupPoller: GroupMessagePoller | undefined;

  const processMessage = async (
    msg: NormalizedMessage,
    alreadyClaimed = false,
  ): Promise<void> => {
    if (groupPoller && !alreadyClaimed && !groupPoller.claim(msg.messageId)) return;
    const chatMode = msg.chatMode ?? msg.chatType;
    const botSender = msg.senderType === 'bot';
    if (msg.senderType && msg.senderType !== 'user' && !botSender) return;
    const isolationMode = isolationStore.get(msg.chatId);
    // A peer bot has no human owner who could operate member-owned approval /
    // question cards. Keep its handoff in this instance's group/topic scope;
    // each bot instance is already isolated by its bridge profile.
    const effectiveIsolationMode = botSender && isolationMode === 'member'
      ? 'topic'
      : isolationMode;
    const scope = isolatedScope({
      chatId: msg.chatId,
      chatMode,
      ...(msg.threadId ? { threadId: msg.threadId } : {}),
      ...(msg.senderId ? { senderId: msg.senderId } : {}),
    }, effectiveIsolationMode);
    if (
      deps.eventFreshnessMs !== undefined &&
      deps.eventFreshnessMs > 0 &&
      !isEventFresh(msg.createTime, deps.eventFreshnessMs)
    ) {
      log.warn('channel', 'stale-message-dropped', {
        scope,
        ageMs: Date.now() - msg.createTime,
      });
      return;
    }
    if (msg.senderType === 'user') await deps.handoffGuard?.recordHuman(msg.chatId);
    if (botSender) {
      if (!msg.mentionedBot || !msg.senderId || !await deps.isTrustedBot?.(msg.senderId)) return;
      const decision = await deps.handoffGuard?.recordBot(
        msg.chatId,
        msg.messageId,
        deps.botHandoffMax ?? 6,
      );
      if (decision && !decision.allowed) {
        if (decision.firstTrip) {
          await commandChannel.sendMarkdown(
            msg.chatId,
            bilingualMarkdown(
              `🛑 机器人连续协作已达到 ${deps.botHandoffMax ?? 6} 轮上限。请由任一成员发言后再继续。`,
              `🛑 Bot-to-bot collaboration reached the ${deps.botHandoffMax ?? 6}-turn limit. A member must speak before it can continue.`,
            ),
          );
        }
        return;
      }
    }
    const repliedQuestion = msg.replyToMessageId
      ? deps.questions?.pendingForMessage(msg.replyToMessageId)
      : undefined;
    if (
      chatMode !== 'p2p' &&
      !msg.mentionedBot &&
      deps.groupNoAt !== true &&
      repliedQuestion === undefined
    ) {
      return;
    }
    if (
      chatMode !== 'p2p' &&
      !msg.mentionedBot &&
      deps.groupNoAt === true &&
      repliedQuestion === undefined
    ) {
      const access = deps.accessManager.snapshot();
      if (
        !msg.senderId ||
        !access.allowedUsers.includes(msg.senderId) ||
        (access.allowedChats.length > 0 && !access.allowedChats.includes(msg.chatId))
      ) return;
    }
    if (repliedQuestion) {
      const answer = textualReplyAnswer(msg.rawContentType, msg.content);
      if (!canAnswerQuestionScope(
        repliedQuestion.scope,
        msg.chatId,
        msg.threadId,
        msg.senderId,
      )) {
        await commandChannel.sendMarkdown(
          msg.chatId,
          bilingualMarkdown('⛔ 不能回答其他成员或其他话题的问答卡。', '⛔ You cannot answer another member’s or another topic’s question card.'),
          { replyTo: msg.messageId },
        );
        return;
      }
      if (answer === undefined) {
        await commandChannel.sendMarkdown(
          msg.chatId,
          bilingualMarkdown('请直接回复一条非空文字作为答案。', 'Reply with non-empty text as your answer.'),
          { replyTo: msg.messageId },
        );
        return;
      }
      if (deps.questions?.resolve(repliedQuestion.scope, repliedQuestion.id, answer)) {
        void settleActionCard(
          channel,
          msg.chatId,
          msg.replyToMessageId!,
          msg.threadId,
          bilingualMarkdown('✅ **已提交** — 文字回答已记录，任务将继续执行', '✅ **Submitted** — the text answer was recorded and the task will continue'),
          repliedQuestion.scope,
          'question',
        );
      }
      return;
    }
    deps.scopeDirectory?.register(
      scope,
      msg.chatId,
      msg.threadId,
      chatMode,
      msg.messageId,
    );
    const context = {
      scope,
      chatId: msg.chatId,
      messageId: msg.messageId,
      threadId: msg.threadId,
      chatMode,
      isolationStore,
      isolationMode: effectiveIsolationMode,
      sessions: deps.sessions,
      workspaces: deps.workspaces,
      activeRuns: deps.activeRuns,
      runPolicies: deps.runPolicies,
      concurrencyStore: deps.concurrencyStore,
      defaultScopeConcurrency: deps.defaultScopeConcurrency,
      retentionStore: deps.retentionStore,
      roleStore: deps.roleStore,
      scopeDirectory: deps.scopeDirectory ?? EMPTY_SCOPE_DIRECTORY,
      archiver: deps.archiver,
      defaultRetention: deps.defaultRetention,
      archiveMax: deps.archiveMax,
      archiveMaxAgeDays: deps.archiveMaxAgeDays,
      defaultRunTimeoutMs: deps.defaultRunTimeoutMs,
      accessManager: deps.accessManager,
      isChatAdministrator: async (chatId: string, userId: string) => {
        const response = await channel.rawClient.im.v1.chat.get({
          params: { user_id_type: 'open_id' },
          path: { chat_id: chatId },
        });
        const chat = response.data;
        return chat?.owner_id === userId || chat?.user_manager_id_list?.includes(userId) === true;
      },
      approvals: deps.approvals,
      questions: deps.questions,
      ...(deps.plans ? { plans: deps.plans } : {}),
      densityStore: deps.densityStore,
      ...(deps.permissionPolicies ? { permissionPolicies: deps.permissionPolicies } : {}),
      ...(deps.notificationPreferences ? { notificationPreferences: deps.notificationPreferences } : {}),
      ...(deps.defaultNotificationPreference
        ? { defaultNotificationPreference: deps.defaultNotificationPreference }
        : {}),
      ...(deps.replyPolicies ? { replyPolicies: deps.replyPolicies } : {}),
      ...(deps.executionModes ? { executionModes: deps.executionModes } : {}),
      models: deps.models,
      wizardStore: deps.wizardStore,
      dshConfig: deps.dshConfig,
      channel: commandChannel,
      defaultWorkspace: deps.defaultWorkspace,
      ...(deps.jobs
        ? {
            jobs: deps.jobs,
            requeueJob: async (messageId: string, jobScope: string, workspaceCwd: string) => {
              const record = await deps.jobs!.retry(messageId, jobScope, workspaceCwd);
              if (!record) return false;
              deps.pending.push(jobScope, queuedMessageFromDurable(record.message));
              return true;
            },
          }
        : {}),
      ...(deps.createDiagnosticBundle
        ? { createDiagnosticBundle: deps.createDiagnosticBundle }
        : {}),
      defaultModel: deps.defaultModel,
      ...(deps.resolveDefaultModel
        ? { resolveDefaultModel: () => deps.resolveDefaultModel!(scope) }
        : {}),
      ...(deps.setDefaultModelPreference
        ? { setDefaultModelPreference: deps.setDefaultModelPreference }
        : {}),
      senderId: msg.senderId,
      ...(sessionProjection ? { sessionProjection } : {}),
    };

    const handled = botSender ? false : await tryHandleCommand(msg.content, context).catch(async (error: unknown) => {
      // A failing command must surface to the user, not be silently
      // forwarded to the agent (which would reply with an unrelated agent
      // error and look like the command does not exist).
      log.fail('channel-command', error, { scope });
      try {
        await commandChannel.sendMarkdown(
          msg.chatId,
          bilingualMarkdown(
            `⚠️ 命令执行失败：${error instanceof Error ? error.message : String(error)}`,
            `⚠️ Command failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
          { replyTo: msg.messageId },
        );
      } catch {
        // best effort
      }
      return true;
    });
    if (!handled) {
      // While a run is flushing or the scope is blocked, a new message is
      // not processed immediately. Acknowledge the queue position so the
      // user always knows the message was received and will be worked on.
      const queued = deps.pending.size(scope);
      const busy =
        queued > 0 ||
        deps.pending.isFlushing(scope) ||
        deps.pending.isBlocked(scope);
      const workspaceCwd = deps.workspaces.cwdFor(scope) ?? deps.defaultWorkspace;
      const queuedMessage = botSender
        ? {
            ...msg,
            content: `[来自可信机器人 ${msg.senderName ?? msg.senderId} 的交接]\n${msg.content}`,
            workspaceCwd,
          }
        : { ...msg, workspaceCwd };
      if (deps.jobs) {
        const durableMessage = durableMessageFor(queuedMessage, scope);
        const dedupeWindowMs = deps.replyPolicies?.get(scope).dedupeWindowMs ?? 0;
        let inserted: boolean;
        try {
          if (dedupeWindowMs > 0) {
            const admission = await deps.jobs.enqueueWithDeduplication(durableMessage, dedupeWindowMs);
            if (admission === 'message-id-duplicate') return;
            if (admission === 'content-duplicate') {
              await commandChannel.sendMarkdown(
                msg.chatId,
                bilingualMarkdown(
                  `↩️ 检测到 ${String(dedupeWindowMs / 1_000)} 秒内同一发送者的近似重复任务，本次未重复执行。`,
                  `↩️ Detected a near-duplicate task from the same sender within ${String(dedupeWindowMs / 1_000)} seconds; it was not run again.`,
                ),
                { replyTo: msg.messageId, ...(msg.threadId ? { threadId: msg.threadId } : {}) },
              );
              return;
            }
            inserted = true;
          } else {
            inserted = await deps.jobs.enqueue(durableMessage);
          }
        } catch (error) {
          log.fail('job-ledger', error, { step: 'enqueue', messageId: msg.messageId, scope });
          await commandChannel.sendMarkdown(
            msg.chatId,
            bilingualMarkdown(
              `⚠️ 消息 \`${msg.messageId}\` 未能写入持久任务账本，因此没有接收或执行。请检查本机存储后重新发送；本次不会在后台悄悄运行。`,
              `⚠️ Message \`${msg.messageId}\` could not be written to the durable job ledger, so it was not accepted or executed. Check local storage and resend it; this attempt will not run silently in the background.`,
            ),
            { replyTo: msg.messageId, ...(msg.threadId ? { threadId: msg.threadId } : {}) },
          ).catch((noticeError) => log.fail('job-ledger', noticeError, {
            step: 'enqueue-failure-notice',
            messageId: msg.messageId,
          }));
          return;
        }
        if (!inserted) return;
      }
      if (busy) {
        await commandChannel.sendMarkdown(
          msg.chatId,
          bilingualMarkdown(
            `⏳ 已收到，当前排队中（队列 ${queued + 1} 条）。任务开始后会在这里实时显示进度。`,
            `⏳ Received and queued (position ${queued + 1}). Live progress will appear here when the task starts.`,
          ),
          { replyTo: msg.messageId },
        );
      }
      deps.pending.push(scope, queuedMessage);
    }
  };

  if (deps.groupNoAt && deps.scopeDirectory) {
    groupPoller = new GroupMessagePoller({
      pollIntervalMs: deps.groupPollMs ?? 3_000,
      freshnessMs: deps.eventFreshnessMs ?? 600_000,
      source: deps.groupHistorySource ?? larkGroupHistorySource(channel),
      knownChats: () => deps.scopeDirectory?.knownChats() ?? [],
      access: () => deps.accessManager.snapshot(),
      onMessage: (message) => processMessage(message, true),
    });
  }

  channel.on({
    message: processMessage,
    cardAction: async (event) => {
      const value =
        event.action.value && typeof event.action.value === 'object'
          ? (event.action.value as Record<string, unknown>)
          : undefined;
      const command = typeof value?.cmd === 'string' ? value.cmd : undefined;
      log.info('card-action', 'received', {
        chatId: event.chatId,
        messageId: event.messageId,
        operatorId: event.operator?.openId,
        command,
      });
      const threadId = cardActionThreadId(event.raw);
      const currentScope = isolatedScope({
        chatId: event.chatId,
        chatMode: threadId ? 'topic' : 'group',
        ...(threadId ? { threadId } : {}),
        ...(event.operator?.openId ? { senderId: event.operator.openId } : {}),
      }, isolationStore.get(event.chatId));
      const requestedScope = typeof value?.scope === 'string' ? value.scope : undefined;
      if (
        requestedScope !== undefined &&
        !canOperateCardScope(requestedScope, event.chatId, event.operator?.openId)
      ) {
        return {
          toast: { type: 'error', content: '不能操作其他成员的隔离会话 / You cannot operate another member’s isolated session' },
        };
      }
      const scope = requestedScope ?? currentScope;
      if (value?.cmd === 'status-refresh') {
        if (!event.messageId || !commandChannel.updateCard) {
          return { toast: { type: 'error', content: '当前渠道不支持原位刷新 / In-place refresh is unavailable' } };
        }
        try {
          const actionIsolation =
            value.isolation === 'p2p' ||
            value.isolation === 'group' ||
            value.isolation === 'topic' ||
            value.isolation === 'member'
              ? value.isolation
              : undefined;
          const chatMode = actionIsolation === 'p2p'
            ? 'p2p'
            : threadId
              ? 'topic'
              : 'group';
          const effectiveIsolation = actionIsolation === 'p2p'
            ? undefined
            : (actionIsolation ?? isolationStore.get(event.chatId));
          const input = await statusCardInputFor({
            scope,
            chatMode,
            sessions: deps.sessions,
            workspaces: deps.workspaces,
            activeRuns: deps.activeRuns,
            roleStore: deps.roleStore,
            ...(effectiveIsolation ? { isolationMode: effectiveIsolation } : {}),
            approvals: deps.approvals,
            questions: deps.questions,
            ...(deps.plans ? { plans: deps.plans } : {}),
            ...(deps.permissionPolicies ? { permissionPolicies: deps.permissionPolicies } : {}),
            ...(deps.notificationPreferences ? { notificationPreferences: deps.notificationPreferences } : {}),
            ...(deps.defaultNotificationPreference
              ? { defaultNotificationPreference: deps.defaultNotificationPreference }
              : {}),
            ...(deps.replyPolicies ? { replyPolicies: deps.replyPolicies } : {}),
            ...(deps.executionModes ? { executionModes: deps.executionModes } : {}),
            ...(sessionProjection ? { sessionProjection } : {}),
            models: deps.models,
            dshConfig: deps.dshConfig,
            ...(deps.resolveDefaultModel
              ? { resolveDefaultModel: () => deps.resolveDefaultModel!(scope) }
              : {}),
            defaultModel: deps.defaultModel,
            defaultWorkspace: deps.defaultWorkspace,
          });
          await commandChannel.updateCard(event.messageId, renderStatusCard(input));
          return { toast: { type: 'success', content: '状态已刷新 / Status refreshed' } };
        } catch (error) {
          log.fail('channel-status', error, { scope });
          return { toast: { type: 'error', content: '状态刷新失败 / Status refresh failed' } };
        }
      }
      if (value?.cmd === 'stop') {
        const runId = typeof value.runId === 'string' ? value.runId : undefined;
        if (runId) {
          await deps.activeRuns.interruptRun(scope, runId);
        } else {
          // Compatibility for cards created before run-scoped stop actions.
          await deps.activeRuns.interrupt(scope);
        }
        return;
      }
      if (value?.cmd === 'execution-mode' && deps.executionModes) {
        const mode = value.mode;
        const actorId = typeof value.actorId === 'string' ? value.actorId : undefined;
        if (
          scope !== currentScope ||
          actorId === undefined ||
          actorId !== event.operator?.openId ||
          (mode !== 'quick' && mode !== 'balanced' && mode !== 'deep')
        ) {
          return { toast: { type: 'error', content: '此模式卡已失效，请重新发送 /mode / This mode card is stale; send /mode again' } };
        }
        try {
          await deps.executionModes.set(scope, mode);
          return { toast: { type: 'success', content: `已切换为 ${mode}，下一轮生效 / Switched to ${mode} for the next turn` } };
        } catch (error) {
          log.fail('execution-mode', error, { scope });
          return { toast: { type: 'error', content: '执行模式保存失败 / Failed to save execution mode' } };
        }
      }
      if (value?.cmd === 'approve' && typeof value.id === 'string' && deps.approvals) {
        const outcome = value.outcome === 'allow' ? 'allowed-once' : 'rejected';
        const settled = deps.approvals.resolve(scope, value.id, outcome);
        if (!settled) {
          log.warn('card-action', 'stale', { kind: 'approval', scope, messageId: event.messageId });
          return {
            toast: {
              type: 'error',
              content: '此审批卡已失效，请使用最新卡片 / This approval card is stale; use the latest card',
            },
          };
        }
        const allowed = outcome === 'allowed-once';
        void settleActionCard(
          channel,
          event.chatId,
          event.messageId,
          threadId,
          allowed
            ? bilingualMarkdown('✅ **已允许** — 该操作已获授权执行', '✅ **Allowed** — this operation is authorized')
            : bilingualMarkdown('⛔ **已拒绝** — 该操作未获授权', '⛔ **Rejected** — this operation is not authorized'),
          scope,
          'approval',
        );
        return {
          toast: {
            type: allowed ? 'success' : 'info',
            content: allowed ? '已允许 / Allowed' : '已拒绝 / Rejected',
          },
        };
      }
      if (value?.cmd === 'question-submit' && typeof value.id === 'string' && deps.questions) {
        const question = deps.questions.get(scope, value.id);
        const form = event.action.formValue;
        if (question) {
          const answer = extractQuestionAnswer(
            question.kind,
            form?.answer,
            question.options,
          );
          const settled = deps.questions.resolve(scope, value.id, answer);
          if (!settled) {
            log.warn('card-action', 'stale', { kind: 'question', scope, messageId: event.messageId });
            return {
              toast: {
                type: 'error',
                content: '此问答卡已失效，请使用最新卡片 / This question card is stale; use the latest card',
              },
            };
          }
          void settleActionCard(
            channel,
            event.chatId,
            event.messageId,
            threadId,
            bilingualMarkdown('✅ **已提交** — 回答已记录，任务将继续执行', '✅ **Submitted** — the answer was recorded and the task will continue'),
            scope,
            'question',
          );
          return {
            toast: { type: 'success', content: '回答已提交 / Answer submitted' },
          };
        }
        log.warn('card-action', 'stale', { kind: 'question', scope, messageId: event.messageId });
        return {
          toast: {
            type: 'error',
            content: '此问答卡已失效，请使用最新卡片 / This question card is stale; use the latest card',
          },
        };
      }
      if (value?.cmd === 'plan-submit' && typeof value.id === 'string' && deps.plans) {
        const decision = value.decision === 'approved' ? 'approved' : 'revise';
        const rawFeedback = event.action.formValue?.feedback;
        const feedback = typeof rawFeedback === 'string' && rawFeedback.trim()
          ? rawFeedback.trim()
          : undefined;
        const settled = deps.plans.resolve(scope, value.id, {
          decision,
          ...(feedback ? { feedback } : {}),
        });
        if (!settled) {
          log.warn('card-action', 'stale', { kind: 'plan', scope, messageId: event.messageId });
          return {
            toast: {
              type: 'error',
              content: '此计划卡已失效，请使用最新卡片 / This plan card is stale; use the latest card',
            },
          };
        }
        const approved = decision === 'approved';
        void settleActionCard(
          channel,
          event.chatId,
          event.messageId,
          threadId,
          approved
            ? bilingualMarkdown('✅ **计划已批准** — 任务将自动继续执行', '✅ **Plan approved** — the task will continue automatically')
            : bilingualMarkdown(
                `📝 **继续规划**${feedback ? ` — 已记录意见：${feedback}` : ''}`,
                `📝 **Continue planning**${feedback ? ` — feedback recorded: ${feedback}` : ''}`,
              ),
          scope,
          'plan',
        );
        return {
          toast: {
            type: approved ? 'success' : 'info',
            content: approved ? '计划已批准 / Plan approved' : '已要求继续规划 / Continue planning requested',
          },
        };
      }
      if (value?.cmd === 'wizard' && deps.wizardStore) {
        try {
          await handleWizardCardAction(
            value,
            event.action.formValue,
            wizardContextFor(event, deps, commandChannel, scope),
          );
        } catch (error) {
          log.fail('channel-wizard', error, { scope });
        }
        return;
      }
      if (value?.cmd === 'cfg' && deps.wizardStore) {
        try {
          await handleConfigHubAction(
            typeof value.action === 'string' ? value.action : '',
            wizardContextFor(event, deps, commandChannel, scope),
            value,
          );
        } catch (error) {
          log.fail('channel-wizard', error, { scope });
        }
        return;
      }
      if (value?.cmd === 'session-projection' && sessionProjection) {
        return sessionProjection.handleAction({
          value,
          operatorId: event.operator?.openId,
          chatId: event.chatId,
          threadId,
          currentScope,
        });
      }
    },
    reconnecting: () => {
      log.warn('channel', 'reconnecting', {});
      void reconnectNotifier.reconnecting().catch((error) => {
        log.fail('channel-reconnect-notice', error);
      });
    },
    reconnected: () => {
      log.info('channel', 'reconnected', {});
      void reconnectNotifier.reconnected().catch((error) => {
        log.fail('channel-reconnect-notice', error);
      });
    },
    error: (error) => {
      log.fail('channel', error);
    },
  });

  await channel.connect();
  if (sessionProjectionBridge) {
    void sessionProjectionBridge.start().catch((error) => {
      log.fail('session-projection', error, { step: 'start' });
    });
  }
  if (groupPoller) {
    groupPoller.start();
    if (deps.accessManager.snapshot().allowedUsers.length === 0) {
      log.warn('group-poller', 'no-allowed-users', {
        reason: 'group no-at polling requires an explicit allowedUsers entry',
      });
    }
    log.info('group-poller', 'started', { pollIntervalMs: deps.groupPollMs ?? 3_000 });
  }
  return {
    channel,
    disconnect: async () => {
      await groupPoller?.stop();
      sessionProjection?.close();
      await sessionProjectionBridge?.close();
      await channel.disconnect();
    },
  };
}

function durableMessageFor(message: QueuedMessage, scope: string): DurableQueuedMessage {
  return {
    messageId: message.messageId,
    scope,
    workspaceCwd: message.workspaceCwd,
    chatId: message.chatId,
    chatType: message.chatType,
    ...(message.chatMode ? { chatMode: message.chatMode } : {}),
    senderId: message.senderId,
    ...(message.senderName ? { senderName: message.senderName } : {}),
    ...(message.senderType ? { senderType: message.senderType } : {}),
    content: message.content,
    rawContentType: message.rawContentType,
    resources: structuredClone(message.resources) as unknown[],
    mentions: structuredClone(message.mentions) as unknown[],
    mentionAll: message.mentionAll,
    mentionedBot: message.mentionedBot,
    ...(message.rootId ? { rootId: message.rootId } : {}),
    ...(message.threadId ? { threadId: message.threadId } : {}),
    ...(message.replyToMessageId ? { replyToMessageId: message.replyToMessageId } : {}),
    createTime: message.createTime,
  };
}

export function queuedMessageFromDurable(message: DurableQueuedMessage): QueuedMessage {
  return {
    messageId: message.messageId,
    chatId: message.chatId,
    chatType: message.chatType,
    ...(message.chatMode ? { chatMode: message.chatMode } : {}),
    senderId: message.senderId,
    ...(message.senderName ? { senderName: message.senderName } : {}),
    ...(message.senderType ? { senderType: message.senderType } : {}),
    ...(message.senderType === 'bot' ? { senderIsBot: true } : {}),
    content: message.content,
    rawContentType: message.rawContentType,
    resources: message.resources as QueuedMessage['resources'],
    mentions: message.mentions as QueuedMessage['mentions'],
    mentionAll: message.mentionAll,
    mentionedBot: message.mentionedBot,
    ...(message.rootId ? { rootId: message.rootId } : {}),
    ...(message.threadId ? { threadId: message.threadId } : {}),
    ...(message.replyToMessageId ? { replyToMessageId: message.replyToMessageId } : {}),
    createTime: message.createTime,
    workspaceCwd: message.workspaceCwd,
  };
}

function canOperateCardScope(
  scope: string,
  chatId: string,
  operatorId: string | undefined,
): boolean {
  if (scope !== chatId && !scope.startsWith(`${chatId}:`)) return false;
  const memberOwner = memberOwnerForScope(scope, chatId);
  return memberOwner === undefined || memberOwner === operatorId;
}

function canAnswerQuestionScope(
  scope: string,
  chatId: string,
  threadId: string | undefined,
  operatorId: string | undefined,
): boolean {
  if (!operatorId) return false;
  if (!canOperateCardScope(scope, chatId, operatorId)) return false;
  if (memberOwnerForScope(scope, chatId) !== undefined) return true;
  return scope === chatId || (threadId !== undefined && scope === `${chatId}:${threadId}`);
}

function textualReplyAnswer(messageType: string, content: string): string | undefined {
  if (messageType !== 'text' && messageType !== 'post') return undefined;
  const answer = content.trim();
  return answer || undefined;
}

function larkGroupHistorySource(channel: LarkChannel): GroupHistorySource {
  return {
    async listMessages(input) {
      const response = await channel.rawClient.im.message.list({
        params: {
          container_id_type: 'chat',
          container_id: input.chatId,
          start_time: input.startTime,
          sort_type: 'ByCreateTimeAsc',
          page_size: input.pageSize,
          ...(input.pageToken ? { page_token: input.pageToken } : {}),
        },
      });
      if (response.code !== undefined && response.code !== 0) {
        throw new Error(
          `Feishu message history failed (${response.code}): ${response.msg ?? 'unknown error'}`,
        );
      }
      const items = (response.data?.items ?? []).flatMap((item) => {
        const messageId = item.message_id;
        const senderId = item.sender?.id;
        const createTime = normalizeHistoryTime(item.create_time);
        if (!messageId || !senderId || createTime === undefined) return [];
        return [{
          messageId,
          chatId: item.chat_id ?? input.chatId,
          createTime,
          senderId,
          senderType: item.sender?.sender_type ?? '',
          messageType: item.msg_type ?? '',
          deleted: item.deleted === true,
        }];
      });
      const pageToken = response.data?.page_token;
      return {
        items,
        hasMore: response.data?.has_more === true,
        ...(pageToken ? { pageToken } : {}),
      };
    },
    fetchMessage: (messageId) => channel.fetchMessage(messageId),
    getChatMode: (chatId) => channel.getChatMode(chatId),
  };
}

function normalizeHistoryTime(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed < 1_000_000_000_000 ? parsed * 1_000 : parsed;
}

async function settleActionCard(
  channel: Pick<LarkChannel, 'send' | 'recallMessage'>,
  chatId: string,
  messageId: string,
  threadId: string | undefined,
  markdown: string,
  scope: string,
  kind: 'approval' | 'question' | 'plan',
): Promise<void> {
  try {
    await channel.send(chatId, { markdown }, {
      replyTo: messageId,
      ...(threadId ? { replyInThread: true } : {}),
    });
  } catch (error) {
    log.warn('channel', `${kind}-confirm-failed`, {
      scope,
      messageId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  try {
    await channel.recallMessage(messageId);
  } catch (error) {
    log.warn('channel', `${kind}-recall-failed`, {
      scope,
      messageId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function cardActionThreadId(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const message = (raw as { message?: unknown }).message;
  if (!message || typeof message !== 'object') return undefined;
  const threadId = (message as { thread_id?: unknown }).thread_id;
  return typeof threadId === 'string' && threadId ? threadId : undefined;
}

const EMPTY_SCOPE_DIRECTORY: ScopeDirectory = {
  register: () => {},
  resolve: () => undefined,
  resolveChat: () => undefined,
  knownScopes: () => [],
  flush: async () => {},
} as unknown as ScopeDirectory;

const EMPTY_ISOLATION_STORE: Pick<IsolationStore, 'get' | 'set'> = {
  get: () => 'topic',
  set: () => {},
};

function wizardContextFor(
  event: { chatId: string; operator: { openId: string } },
  deps: Pick<
    StartChannelDeps,
    | 'dshConfig'
    | 'accessManager'
    | 'models'
    | 'wizardStore'
    | 'defaultModel'
    | 'resolveDefaultModel'
    | 'setDefaultModelPreference'
  >,
  channel: CommandChannel,
  scope: string,
): ConfigWizardContext {
  return {
    scope,
    chatId: event.chatId,
    senderId: event.operator.openId,
    channel,
    dshConfig: deps.dshConfig,
    accessManager: deps.accessManager,
    models: deps.models,
    wizards: deps.wizardStore,
    defaultModel: deps.defaultModel,
    ...(deps.resolveDefaultModel
      ? { resolveDefaultModel: () => deps.resolveDefaultModel!(scope) }
      : {}),
    ...(deps.setDefaultModelPreference
      ? { setDefaultModelPreference: deps.setDefaultModelPreference }
      : {}),
  };
}
