import { randomUUID } from 'node:crypto';
import type { QuestionCardInput } from '../card/question-card.js';

interface PendingQuestion {
  input: QuestionCardInput;
  resolve: (answer: string | string[] | undefined) => void;
  settled: boolean;
}

/**
 * Pending question-card registry. `/ask` registers a card; the card submit
 * action resolves it, and the answer is recorded back into the session.
 */
export class QuestionRegistry {
  private readonly pending = new Map<string, PendingQuestion>();

  register(
    scope: string,
    input: Omit<QuestionCardInput, 'id'>,
  ): { id: string; promise: Promise<string | string[] | undefined> } {
    const id = `question-${randomUUID().replaceAll('-', '')}`;
    const full: QuestionCardInput = { ...input, id };
    const promise = new Promise<string | string[] | undefined>((resolve) => {
      this.pending.set(`${scope}:${id}`, { input: full, resolve, settled: false });
    });
    return { id, promise };
  }

  resolve(scope: string, id: string, answer: string | string[] | undefined): boolean {
    const pending = this.pending.get(`${scope}:${id}`);
    if (!pending || pending.settled) return false;
    pending.settled = true;
    this.pending.delete(`${scope}:${id}`);
    pending.resolve(answer);
    return true;
  }

  settleAll(scope: string): number {
    let count = 0;
    for (const [key, pending] of this.pending) {
      if (!key.startsWith(`${scope}:`)) continue;
      if (pending.settled) continue;
      pending.settled = true;
      this.pending.delete(key);
      pending.resolve(undefined);
      count += 1;
    }
    return count;
  }

  get(scope: string, id: string): QuestionCardInput | undefined {
    return this.pending.get(`${scope}:${id}`)?.input;
  }
}
