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
import type { RunPolicyStore } from '../bot/run-policy.js';
import { tryHandleCommand, type CommandChannel } from '../commands/index.js';
import { extractQuestionAnswer } from '../card/question-card.js';
import type { AccessManager } from '../config/access-manager.js';
import type { DshProviderManager } from '../config/dsh-config.js';
import { isEventFresh } from '../config/security.js';
import { log } from '../core/logger.js';
import type { SessionStore } from '../session/store.js';
import type { SessionArchive } from '../session/archive.js';
import type { WorkspaceStore } from '../workspace/store.js';
import { adaptLarkChannel } from './lark-channel.js';

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
  dshConfig: DshProviderManager;
  defaultWorkspace: string;
  defaultModel: string;
  allowedUsers?: string[];
  allowedChats?: string[];
  accessDefaultDeny?: boolean;
  eventFreshnessMs?: number;
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

  channel.on({
    message: async (msg) => {
      const scope = scopeForMessage(msg);
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
        dshConfig: deps.dshConfig,
        channel: commandChannel,
        defaultWorkspace: deps.defaultWorkspace,
        defaultModel: deps.defaultModel,
        senderId: msg.senderId,
      };

      const handled = await tryHandleCommand(msg.content, context).catch((error: unknown) => {
        log.fail('channel-command', error, { scope });
        return false;
      });
      if (!handled) deps.pending.push(scope, msg);
    },
    cardAction: async (event) => {
      const value =
        event.action.value && typeof event.action.value === 'object'
          ? (event.action.value as Record<string, unknown>)
          : undefined;
      const scope = event.raw
        ? await resolveCardScope(event.chatId, event.raw as { message?: { thread_id?: string } })
        : event.chatId;
      if (value?.cmd === 'stop') {
        await deps.activeRuns.interrupt(scope);
        return;
      }
      if (value?.cmd === 'approve' && typeof value.id === 'string' && deps.approvals) {
        const outcome = value.outcome === 'allow' ? 'allowed-once' : 'rejected';
        deps.approvals.resolve(scope, value.id, outcome);
        return;
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
          deps.questions.resolve(scope, value.id, answer);
        }
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
  return {
    channel,
    disconnect: () => channel.disconnect(),
  };
}

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
