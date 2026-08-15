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
    sendCard(chatId: string, card: object, options?: SendOptions): Promise<void>;
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
): (payload: AskPayload) => Promise<AskResult> {
  return async (payload) => {
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
    const { id, promise } = deps.questions.register(scope, input);
    try {
      await deps.channel.sendCard(
        destination.chatId,
        renderQuestionCard({ ...input, id }),
        destination.threadId ? { threadId: destination.threadId } : undefined,
      );
    } catch (error) {
      log.fail('ask-card', error, { scope });
      deps.questions.settleAll(scope);
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
  };
}
