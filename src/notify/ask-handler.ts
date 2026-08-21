import { renderQuestionCard, type QuestionCardInput, type QuestionKind } from '../card/question-card.js';
import { log } from '../core/logger.js';
import type { QuestionRegistry } from '../bot/questions.js';
import type { SessionStore } from '../session/store.js';
import type { ScopeDirectory } from '../bridge/scope-directory.js';
import type { SendOptions } from '../bridge/send-options.js';

export interface AskPayload {
  token: string;
  sessionId: string;
  question: string;
  kind?: QuestionKind;
  options?: string[];
  header?: string;
}

export interface AskResult {
  ok: boolean;
  answer?: string | string[] | null;
  error?: string;
}

export interface AskHandlerDeps {
  sessions: SessionStore;
  scopeDirectory: ScopeDirectory;
  questions: QuestionRegistry;
  channel: {
    sendCard(chatId: string, card: object, options?: SendOptions): Promise<string | undefined>;
  };
}

/**
 * Route one `lark_ask_user` tool request to a Feishu/Lark question card and
 * wait for the human answer. The runtime tool identifies itself by its dsh
 * session id, which the bridge records per scope at run start; the scope is
 * resolved to the chat/thread the card is sent to.
 */
export function buildAskHandler(
  deps: AskHandlerDeps,
): (payload: AskPayload, signal?: AbortSignal) => Promise<AskResult> {
  return async (payload, signal) => {
    const scope = deps.sessions.scopeForSession(payload.sessionId);
    if (!scope) {
      return { ok: false, error: `unknown session: ${payload.sessionId}` };
    }
    const destination = deps.scopeDirectory.resolve(scope);
    if (!destination) {
      return { ok: false, error: `unknown scope: ${scope}` };
    }
    const kind =
      payload.kind ?? (payload.options && payload.options.length > 0 ? 'single' : 'text');
    const input: Omit<QuestionCardInput, 'id'> = {
      kind,
      question: payload.question,
      ...(payload.options && payload.options.length > 0
        ? { options: payload.options }
        : {}),
    };
    if (signal?.aborted) return { ok: false, error: 'question cancelled' };
    const { id, promise } = deps.questions.register(scope, input, payload.sessionId);
    const cancel = (): void => {
      deps.questions.cancel(scope, id);
    };
    signal?.addEventListener('abort', cancel, { once: true });
    // Abort may have happened after the check above but before listener
    // registration. EventTarget does not replay an already-fired abort.
    if (signal?.aborted) cancel();
    try {
      if (signal?.aborted) return { ok: false, error: 'question cancelled' };
      try {
        const messageId = await deps.channel.sendCard(
          destination.chatId,
          renderQuestionCard({ ...input, id, actionScope: scope }),
          destination.threadId && destination.messageId
            ? { threadId: destination.threadId, replyTo: destination.messageId }
            : undefined,
        );
        if (messageId) deps.questions.bindMessage(scope, id, messageId);
      } catch (error) {
        log.fail('ask-card', error, { scope });
        deps.questions.cancel(scope, id);
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      const answer = await promise;
      if (answer === undefined) {
        return { ok: false, error: 'question cancelled' };
      }
      return { ok: true, answer };
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
  };
}
