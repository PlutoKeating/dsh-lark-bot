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
import { tryHandleCommand, type CommandChannel } from '../commands/index.js';
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
import type { SessionStore } from '../session/store.js';
import type { SessionArchive } from '../session/archive.js';
import type { WorkspaceStore } from '../workspace/store.js';
import { adaptLarkChannel } from './lark-channel.js';
import {
  GroupMessagePoller,
  type GroupHistorySource,
} from './group-message-poller.js';
import type { ScopeDirectory } from './scope-directory.js';

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
  scopeDirectory?: ScopeDirectory;
  archiver: SessionArchive;
  defaultRetention: number;
  archiveMax: number;
  archiveMaxAgeDays: number;
  defaultRunTimeoutMs: number;
  accessManager: AccessManager;
  pending: PendingQueue<NormalizedMessage>;
  approvals?: ApprovalRegistry;
  questions?: QuestionRegistry;
  densityStore?: DensityStore;
  models: ModelStore;
  wizardStore: WizardStore;
  dshConfig: DshProviderManager;
  defaultWorkspace: string;
  defaultModel: string;
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
  /** Injectable history source for deterministic tests. */
  groupHistorySource?: GroupHistorySource;
  stopGraceMs?: number;
  createChannel?: typeof createLarkChannel;
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
      requireMention: true,
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
  let groupPoller: GroupMessagePoller | undefined;

  const processMessage = async (
    msg: NormalizedMessage,
    alreadyClaimed = false,
  ): Promise<void> => {
    if (groupPoller && !alreadyClaimed && !groupPoller.claim(msg.messageId)) return;
    const scope = scopeForMessage(msg);
    deps.scopeDirectory?.register(
      scope,
      msg.chatId,
      msg.threadId,
      msg.chatMode ?? msg.chatType,
    );
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
    const context = {
      scope,
      chatId: msg.chatId,
      messageId: msg.messageId,
      threadId: msg.threadId,
      chatMode: msg.chatMode ?? msg.chatType,
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
      approvals: deps.approvals,
      questions: deps.questions,
      densityStore: deps.densityStore,
      models: deps.models,
      wizardStore: deps.wizardStore,
      dshConfig: deps.dshConfig,
      channel: commandChannel,
      defaultWorkspace: deps.defaultWorkspace,
      defaultModel: deps.defaultModel,
      ...(deps.setDefaultModelPreference
        ? { setDefaultModelPreference: deps.setDefaultModelPreference }
        : {}),
      senderId: msg.senderId,
    };

    const handled = await tryHandleCommand(msg.content, context).catch(async (error: unknown) => {
      // A failing command must surface to the user, not be silently
      // forwarded to the agent (which would reply with an unrelated agent
      // error and look like the command does not exist).
      log.fail('channel-command', error, { scope });
      try {
        await commandChannel.sendMarkdown(
          msg.chatId,
          `⚠️ 命令执行失败：${error instanceof Error ? error.message : String(error)}`,
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
      if (busy) {
        await commandChannel.sendMarkdown(
          msg.chatId,
          `⏳ 已收到，当前排队中（队列 ${queued + 1} 条）。任务开始后会在这里实时显示进度。`,
          { replyTo: msg.messageId },
        );
      }
      deps.pending.push(scope, msg);
    }
  };

  channel.on({
    message: processMessage,
    cardAction: async (event) => {
      const value =
        event.action.value && typeof event.action.value === 'object'
          ? (event.action.value as Record<string, unknown>)
          : undefined;
      const scope = event.raw
        ? await resolveCardScope(event.chatId, event.raw as { message?: { thread_id?: string } })
        : event.chatId;
      const threadId = cardActionThreadId(event.raw);
      if (value?.cmd === 'stop') {
        await deps.activeRuns.interrupt(scope);
        return;
      }
      if (value?.cmd === 'approve' && typeof value.id === 'string' && deps.approvals) {
        const outcome = value.outcome === 'allow' ? 'allowed-once' : 'rejected';
        const settled = deps.approvals.resolve(scope, value.id, outcome);
        if (!settled) return;
        const allowed = outcome === 'allowed-once';
        void settleActionCard(
          channel,
          event.chatId,
          event.messageId,
          threadId,
          allowed
            ? '✅ **已允许** — 该操作已获授权执行'
            : '⛔ **已拒绝** — 该操作未获授权',
          scope,
          'approval',
        );
        return {
          toast: {
            type: allowed ? 'success' : 'info',
            content: allowed ? '已允许' : '已拒绝',
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
          if (!settled) return;
          void settleActionCard(
            channel,
            event.chatId,
            event.messageId,
            threadId,
            '✅ **已提交** — 回答已记录，任务将继续执行',
            scope,
            'question',
          );
          return {
            toast: { type: 'success', content: '回答已提交' },
          };
        }
        return;
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
          );
        } catch (error) {
          log.fail('channel-wizard', error, { scope });
        }
        return;
      }
    },
    reconnecting: () => {
      log.warn('channel', 'reconnecting', {});
    },
    reconnected: () => {
      log.info('channel', 'reconnected', {});
    },
    error: (error) => {
      log.fail('channel', error);
    },
  });

  await channel.connect();
  if (deps.groupNoAt && deps.scopeDirectory) {
    groupPoller = new GroupMessagePoller({
      pollIntervalMs: deps.groupPollMs ?? 3_000,
      freshnessMs: deps.eventFreshnessMs ?? 600_000,
      source: deps.groupHistorySource ?? larkGroupHistorySource(channel),
      knownChats: () => deps.scopeDirectory?.knownChats() ?? [],
      access: () => deps.accessManager.snapshot(),
      onMessage: (message) => processMessage(message, true),
    });
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
      await channel.disconnect();
    },
  };
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
  kind: 'approval' | 'question',
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

function scopeForMessage(msg: NormalizedMessage): string {
  if (msg.chatMode === 'topic' && msg.threadId) return `${msg.chatId}:${msg.threadId}`;
  return msg.chatId;
}

async function resolveCardScope(
  chatId: string,
  raw: { message?: { thread_id?: string } },
): Promise<string> {
  return raw.message?.thread_id ? `${chatId}:${raw.message.thread_id}` : chatId;
}

function wizardContextFor(
  event: { chatId: string; operator: { openId: string } },
  deps: Pick<
    StartChannelDeps,
    | 'dshConfig'
    | 'accessManager'
    | 'models'
    | 'wizardStore'
    | 'defaultModel'
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
    ...(deps.setDefaultModelPreference
      ? { setDefaultModelPreference: deps.setDefaultModelPreference }
      : {}),
  };
}
