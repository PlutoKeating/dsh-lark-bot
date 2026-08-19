import { randomUUID } from 'node:crypto';
import type { ApprovalOutcome, ApprovalRequest } from '../adapters/types.js';
import type { ApprovalRegistry } from '../bot/approvals.js';
import type { ScopeDirectory } from '../bridge/scope-directory.js';
import type { SendOptions } from '../bridge/send-options.js';
import { renderApprovalCard } from '../card/approval-card.js';
import { log } from '../core/logger.js';
import type { SessionStore } from '../session/store.js';

export interface ApprovalPayload {
  token: string;
  sessionId: string;
  toolName: string;
  callId?: string;
  reason?: string;
  toolInput?: unknown;
}

export interface ApprovalResult {
  ok: boolean;
  outcome?: ApprovalOutcome;
  error?: string;
}

export interface ApprovalHandlerDeps {
  sessions: SessionStore;
  scopeDirectory: ScopeDirectory;
  approvals: ApprovalRegistry;
  channel: {
    sendCard(chatId: string, card: object, options?: SendOptions): Promise<string | undefined>;
    sendMarkdown?(chatId: string, markdown: string, options?: SendOptions): Promise<void>;
    recallMessage?(messageId: string): Promise<void>;
  };
}

export function buildApprovalHandler(
  deps: ApprovalHandlerDeps,
): (payload: ApprovalPayload, signal?: AbortSignal) => Promise<ApprovalResult> {
  return async (payload, signal) => {
    const scope = deps.sessions.scopeForSession(payload.sessionId);
    if (!scope) return { ok: false, error: `unknown session: ${payload.sessionId}` };
    const destination = deps.scopeDirectory.resolve(scope);
    if (!destination) return { ok: false, error: `unknown scope: ${scope}` };
    const id = `approval-${randomUUID().replaceAll('-', '')}`;
    const request: ApprovalRequest = {
      id,
      ...(payload.callId === undefined ? {} : { callId: payload.callId }),
      sessionId: payload.sessionId,
      toolName: payload.toolName,
      reason: payload.reason,
      toolInput: payload.toolInput ?? (payload.callId
        ? deps.approvals.toolInput(payload.sessionId, payload.callId)
        : undefined),
      options: [
        { optionId: 'allow-once', name: '允许执行一次', kind: 'allow_once' },
        { optionId: 'reject-once', name: '拒绝', kind: 'reject_once' },
      ],
    };
    if (signal?.aborted) return { ok: false, error: 'approval cancelled' };
    const promise = deps.approvals.register(scope, request, payload.sessionId);
    let cardMessageId: string | undefined;
    const cancel = (): void => { deps.approvals.cancel(scope, id); };
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    try {
      if (signal?.aborted) return { ok: false, error: 'approval cancelled' };
      const options = destination.threadId && destination.messageId
        ? { threadId: destination.threadId, replyTo: destination.messageId }
        : undefined;
      cardMessageId = await deps.channel.sendCard(
        destination.chatId,
        renderApprovalCard({ ...request, actionScope: scope }),
        options,
      );
      const outcome = await promise;
      if (outcome === 'cancelled') {
        await settleCancelledCard(deps, destination.chatId, cardMessageId, options);
        return { ok: false, error: 'approval cancelled' };
      }
      return { ok: true, outcome };
    } catch (error) {
      log.fail('approval-card', error, { scope, sessionId: payload.sessionId });
      cancel();
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
  };
}

async function settleCancelledCard(
  deps: ApprovalHandlerDeps,
  chatId: string,
  messageId: string | undefined,
  options: SendOptions | undefined,
): Promise<void> {
  try {
    await deps.channel.sendMarkdown?.(chatId, '⏹ **操作审批已取消** — 原任务已结束或断开', options);
  } catch (error) {
    log.warn('approval-card', 'cancel-confirm-failed', { error });
  }
  if (!messageId || !deps.channel.recallMessage) return;
  try {
    await deps.channel.recallMessage(messageId);
  } catch (error) {
    log.warn('approval-card', 'cancel-recall-failed', { error });
  }
}
