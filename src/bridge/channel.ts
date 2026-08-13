import { createLarkChannel, type LarkChannel, type NormalizedMessage } from '@larksuite/channel';
import type { AgentAdapter } from '../adapters/types.js';
import type { ActiveRuns } from '../bot/active-runs.js';
import type { PendingQueue } from '../bot/pending-queue.js';
import type { RunPolicyStore } from '../bot/run-policy.js';
import { tryHandleCommand, type CommandChannel } from '../commands/index.js';
import { log } from '../core/logger.js';
import type { SessionStore } from '../session/store.js';
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
  defaultRunTimeoutMs: number;
  pending: PendingQueue<NormalizedMessage>;
  defaultWorkspace: string;
  model?: string;
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
      dmMode: 'open',
      requireMention: true,
      respondToMentionAll: false,
    },
    safety: {
      chatQueue: { enabled: false },
    },
    outbound: {
      streamThrottleMs: 400,
    },
    includeRawEvent: true,
    handshakeTimeoutMs: 8_000,
    httpTimeoutMs: 30_000,
    respectProxyEnv: true,
  });

  const streaming = adaptLarkChannel(channel);
  const commandChannel: CommandChannel = streaming;

  channel.on({
    message: async (msg) => {
      const scope = scopeForMessage(msg);
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
        defaultRunTimeoutMs: deps.defaultRunTimeoutMs,
        channel: commandChannel,
        defaultWorkspace: deps.defaultWorkspace,
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
      if (value?.cmd === 'stop') {
        const scope = event.raw
          ? await resolveCardScope(event.chatId, event.raw as { message?: { thread_id?: string } })
          : event.chatId;
        await deps.activeRuns.interrupt(scope);
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
