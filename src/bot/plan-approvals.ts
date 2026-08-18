import { randomUUID } from 'node:crypto';

export type PlanDecision =
  | { decision: 'approved'; feedback?: string }
  | { decision: 'revise'; feedback?: string };

interface PendingPlan {
  sessionId: string;
  resolve: (decision: PlanDecision | undefined) => void;
  settled: boolean;
}

/** Pending human plan gates, keyed by the immutable run scope. */
export class PlanApprovalRegistry {
  private readonly pending = new Map<string, Map<string, PendingPlan>>();
  private readonly settledListeners = new Map<string, Set<(sessionId: string) => void>>();

  pendingCount(scope: string, sessionId?: string): number {
    const pending = this.pending.get(scope);
    if (!pending) return 0;
    if (sessionId === undefined) return pending.size;
    let count = 0;
    for (const entry of pending.values()) {
      if (entry.sessionId === sessionId) count += 1;
    }
    return count;
  }

  onSettled(scope: string, listener: (sessionId: string) => void): () => void {
    const listeners = this.settledListeners.get(scope) ??
      new Set<(sessionId: string) => void>();
    listeners.add(listener);
    this.settledListeners.set(scope, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.settledListeners.delete(scope);
    };
  }

  register(
    scope: string,
    sessionId: string,
  ): { id: string; promise: Promise<PlanDecision | undefined> } {
    const id = `plan-${randomUUID().replaceAll('-', '')}`;
    const promise = new Promise<PlanDecision | undefined>((resolve) => {
      const scopePending = this.pending.get(scope) ?? new Map<string, PendingPlan>();
      scopePending.set(id, { sessionId, resolve, settled: false });
      this.pending.set(scope, scopePending);
    });
    return { id, promise };
  }

  resolve(scope: string, id: string, decision: PlanDecision): boolean {
    const scopePending = this.pending.get(scope);
    const pending = scopePending?.get(id);
    if (!pending || pending.settled) return false;
    pending.settled = true;
    scopePending?.delete(id);
    if (scopePending?.size === 0) this.pending.delete(scope);
    pending.resolve(decision);
    this.notifySettled(scope, pending.sessionId);
    return true;
  }

  cancel(scope: string, id: string): boolean {
    const scopePending = this.pending.get(scope);
    const pending = scopePending?.get(id);
    if (!pending || pending.settled) return false;
    pending.settled = true;
    scopePending?.delete(id);
    if (scopePending?.size === 0) this.pending.delete(scope);
    pending.resolve(undefined);
    this.notifySettled(scope, pending.sessionId);
    return true;
  }

  settleSession(scope: string, sessionId: string): number {
    let count = 0;
    const scopePending = this.pending.get(scope);
    if (!scopePending) return 0;
    for (const [id, pending] of scopePending) {
      if (pending.settled || pending.sessionId !== sessionId) continue;
      pending.settled = true;
      scopePending.delete(id);
      pending.resolve(undefined);
      count += 1;
    }
    if (scopePending.size === 0) this.pending.delete(scope);
    if (count > 0) this.notifySettled(scope, sessionId);
    return count;
  }

  private notifySettled(scope: string, sessionId: string): void {
    for (const listener of this.settledListeners.get(scope) ?? []) listener(sessionId);
  }
}
