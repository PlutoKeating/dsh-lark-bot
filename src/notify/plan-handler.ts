import type { PlanApprovalRegistry, PlanDecision } from '../bot/plan-approvals.js';
import type { ScopeDirectory } from '../bridge/scope-directory.js';
import type { SendOptions } from '../bridge/send-options.js';
import { renderPlanApprovalCard } from '../card/plan-approval-card.js';
import { log } from '../core/logger.js';
import type { SessionStore } from '../session/store.js';
import { bilingualMarkdown } from '../card/i18n.js';

export interface PlanPayload {
  token: string;
  sessionId: string;
  plan: string;
}

export interface PlanResult {
  ok: boolean;
  decision?: PlanDecision['decision'];
  feedback?: string;
  error?: string;
}

export interface PlanHandlerDeps {
  sessions: SessionStore;
  scopeDirectory: ScopeDirectory;
  plans: PlanApprovalRegistry;
  channel: {
    sendMarkdown(chatId: string, markdown: string, options?: SendOptions): Promise<void>;
    sendCard(chatId: string, card: object, options?: SendOptions): Promise<string | undefined>;
    recallMessage?(messageId: string): Promise<void>;
  };
}

/** Send the full plan as readable markdown, then block on a compact decision card. */
export function buildPlanHandler(
  deps: PlanHandlerDeps,
): (payload: PlanPayload, signal?: AbortSignal) => Promise<PlanResult> {
  return async (payload, signal) => {
    const scope = deps.sessions.scopeForSession(payload.sessionId);
    if (!scope) return { ok: false, error: `unknown session: ${payload.sessionId}` };
    const destination = deps.scopeDirectory.resolve(scope);
    if (!destination) return { ok: false, error: `unknown scope: ${scope}` };
    const options = destination.threadId ? { threadId: destination.threadId } : undefined;
    let id: string | undefined;
    let cardMessageId: string | undefined;
    const cancel = (): void => {
      if (id !== undefined) deps.plans.cancel(scope, id);
    };
    try {
      if (signal?.aborted) return { ok: false, error: 'plan approval cancelled' };
      await deps.channel.sendMarkdown(destination.chatId, payload.plan, options);
      if (signal?.aborted) {
        await settleCancelledCard(deps, destination.chatId, undefined, options);
        return { ok: false, error: 'plan approval cancelled' };
      }
      const registered = deps.plans.register(scope, payload.sessionId);
      id = registered.id;
      signal?.addEventListener('abort', cancel, { once: true });
      // Abort may have happened after the check above but before listener
      // registration. EventTarget does not replay an already-fired abort.
      if (signal?.aborted) {
        cancel();
        await settleCancelledCard(deps, destination.chatId, undefined, options);
        return { ok: false, error: 'plan approval cancelled' };
      }
      cardMessageId = await deps.channel.sendCard(
        destination.chatId,
        renderPlanApprovalCard({ id: registered.id, actionScope: scope }),
        options,
      );
      const result = await registered.promise;
      if (!result) {
        await settleCancelledCard(deps, destination.chatId, cardMessageId, options);
        return { ok: false, error: 'plan approval cancelled' };
      }
      return { ok: true, ...result };
    } catch (error) {
      log.fail('plan-card', error, { scope });
      cancel();
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
  };
}

async function settleCancelledCard(
  deps: PlanHandlerDeps,
  chatId: string,
  cardMessageId: string | undefined,
  options: SendOptions | undefined,
): Promise<void> {
  try {
    await deps.channel.sendMarkdown(
      chatId,
      bilingualMarkdown(
        '⏹ **计划确认已取消** — 原任务已结束或被停止',
        '⏹ **Plan approval cancelled** — the original task finished or was stopped',
      ),
      options,
    );
  } catch (error) {
    log.warn('plan-card', 'cancel-confirm-failed', { error });
  }
  if (!cardMessageId || !deps.channel.recallMessage) return;
  try {
    await deps.channel.recallMessage(cardMessageId);
  } catch (error) {
    log.warn('plan-card', 'cancel-recall-failed', { error });
  }
}
