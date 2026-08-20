import { randomUUID } from 'node:crypto';
import type { QuestionCardInput } from '../card/question-card.js';

interface PendingQuestion {
  input: QuestionCardInput;
  sessionId?: string;
  resolve: (answer: string | string[] | undefined) => void;
  settled: boolean;
  cardMessageId?: string;
}

export interface PendingQuestionByMessage {
  scope: string;
  id: string;
  input: QuestionCardInput;
}

/**
 * Pending question-card registry. `/ask` registers a card; the card submit
 * action resolves it, and the answer is recorded back into the session.
 */
export class QuestionRegistry {
  private readonly pending = new Map<string, PendingQuestion>();
  private readonly messageIndex = new Map<string, string>();
  private readonly settledListeners = new Map<string, Set<(sessionId: string | undefined) => void>>();

  /** Number of question cards currently awaiting an answer in a scope. */
  pendingCount(scope: string, sessionId?: string): number {
    let count = 0;
    for (const [key, pending] of this.pending) {
      if (
        key.startsWith(`${scope}:`) &&
        (sessionId === undefined || pending.sessionId === sessionId)
      ) count += 1;
    }
    return count;
  }

  /** Subscribe to question settlements in a scope; returns an unsubscribe. */
  onSettled(
    scope: string,
    listener: (sessionId: string | undefined) => void,
  ): () => void {
    const listeners = this.settledListeners.get(scope) ??
      new Set<(sessionId: string | undefined) => void>();
    listeners.add(listener);
    this.settledListeners.set(scope, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.settledListeners.delete(scope);
    };
  }

  private notifySettled(scope: string, sessionId: string | undefined): void {
    for (const listener of this.settledListeners.get(scope) ?? []) listener(sessionId);
  }

  register(
    scope: string,
    input: Omit<QuestionCardInput, 'id'>,
    sessionId?: string,
  ): { id: string; promise: Promise<string | string[] | undefined> } {
    const id = `question-${randomUUID().replaceAll('-', '')}`;
    const full: QuestionCardInput = { ...input, id };
    const promise = new Promise<string | string[] | undefined>((resolve) => {
      this.pending.set(`${scope}:${id}`, {
        input: full,
        resolve,
        settled: false,
        ...(sessionId === undefined ? {} : { sessionId }),
      });
    });
    return { id, promise };
  }

  resolve(scope: string, id: string, answer: string | string[] | undefined): boolean {
    const key = `${scope}:${id}`;
    const pending = this.pending.get(key);
    if (!pending || pending.settled) return false;
    pending.settled = true;
    this.pending.delete(key);
    if (pending.cardMessageId) this.messageIndex.delete(pending.cardMessageId);
    pending.resolve(answer);
    this.notifySettled(scope, pending.sessionId);
    return true;
  }

  /** Cancel one question without affecting concurrent questions in the scope. */
  cancel(scope: string, id: string): boolean {
    return this.resolve(scope, id, undefined);
  }

  /** Cancel only questions owned by one native runtime session. */
  settleSession(scope: string, sessionId: string): number {
    let count = 0;
    for (const [key, pending] of this.pending) {
      if (!key.startsWith(`${scope}:`) || pending.sessionId !== sessionId) continue;
      if (pending.settled) continue;
      pending.settled = true;
      this.pending.delete(key);
      if (pending.cardMessageId) this.messageIndex.delete(pending.cardMessageId);
      pending.resolve(undefined);
      count += 1;
    }
    if (count > 0) this.notifySettled(scope, sessionId);
    return count;
  }

  settleAll(scope: string): number {
    let count = 0;
    const settledSessions = new Set<string | undefined>();
    for (const [key, pending] of this.pending) {
      if (!key.startsWith(`${scope}:`)) continue;
      if (pending.settled) continue;
      pending.settled = true;
      this.pending.delete(key);
      if (pending.cardMessageId) this.messageIndex.delete(pending.cardMessageId);
      pending.resolve(undefined);
      settledSessions.add(pending.sessionId);
      count += 1;
    }
    for (const sessionId of settledSessions) this.notifySettled(scope, sessionId);
    return count;
  }

  get(scope: string, id: string): QuestionCardInput | undefined {
    return this.pending.get(`${scope}:${id}`)?.input;
  }

  /** Associate the sent card message with its pending question for text replies. */
  bindMessage(scope: string, id: string, messageId: string): boolean {
    const key = `${scope}:${id}`;
    const pending = this.pending.get(key);
    if (!pending || pending.settled || !messageId) return false;
    const existing = this.messageIndex.get(messageId);
    if (existing !== undefined && existing !== key) return false;
    if (pending.cardMessageId && pending.cardMessageId !== messageId) {
      this.messageIndex.delete(pending.cardMessageId);
    }
    pending.cardMessageId = messageId;
    this.messageIndex.set(messageId, key);
    return true;
  }

  /** Resolve the exact pending question addressed by an inbound message reply. */
  pendingForMessage(messageId: string): PendingQuestionByMessage | undefined {
    const key = this.messageIndex.get(messageId);
    if (!key) return undefined;
    const pending = this.pending.get(key);
    if (!pending || pending.settled) {
      this.messageIndex.delete(messageId);
      return undefined;
    }
    const id = pending.input.id;
    const scope = key.slice(0, -(id.length + 1));
    return { scope, id, input: pending.input };
  }
}
