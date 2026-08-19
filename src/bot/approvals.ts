import type { ApprovalOutcome, ApprovalRequest } from '../adapters/types.js';
import { log } from '../core/logger.js';

interface PendingApproval {
  scope: string;
  request: ApprovalRequest;
  sessionId: string | undefined;
  resolve: (outcome: ApprovalOutcome) => void;
  settled: boolean;
}

/**
 * Pending approval registry. Cards are rendered by the caller; this store
 * correlates card button clicks with the ACP `request_permission` promise and
 * guarantees every request is settled when a run ends or is disposed.
 */
export class ApprovalRegistry {
  private readonly pending = new Map<string, PendingApproval>();
  private readonly settledListeners = new Map<string, Set<(sessionId: string | undefined) => void>>();
  private readonly toolCalls = new Map<string, unknown>();

  register(
    scope: string,
    request: ApprovalRequest,
    sessionId = request.sessionId,
  ): Promise<ApprovalOutcome> {
    const key = `${scope}:${request.id}`;
    const existing = this.pending.get(key);
    if (existing) return Promise.resolve('cancelled');
    return new Promise<ApprovalOutcome>((resolve) => {
      this.pending.set(key, { scope, request, sessionId, resolve, settled: false });
    });
  }

  resolve(scope: string, id: string, outcome: ApprovalOutcome): boolean {
    const key = `${scope}:${id}`;
    const pending = this.pending.get(key);
    if (!pending || pending.settled) return false;
    pending.settled = true;
    this.pending.delete(key);
    pending.resolve(outcome);
    this.notifySettled(scope, pending.sessionId);
    return true;
  }

  cancel(scope: string, id: string): boolean {
    return this.resolve(scope, id, 'cancelled');
  }

  settleSession(scope: string, sessionId: string, outcome: ApprovalOutcome): number {
    let count = 0;
    for (const [key, pending] of this.pending) {
      if (pending.scope !== scope || pending.sessionId !== sessionId || pending.settled) continue;
      pending.settled = true;
      this.pending.delete(key);
      pending.resolve(outcome);
      count += 1;
    }
    if (count > 0) this.notifySettled(scope, sessionId);
    return count;
  }

  /** Settle every pending approval for a scope (run end / dispose). */
  settleAll(scope: string, outcome: ApprovalOutcome): number {
    let count = 0;
    for (const [key, pending] of this.pending) {
      if (pending.scope !== scope) continue;
      if (pending.settled) continue;
      pending.settled = true;
      this.pending.delete(key);
      pending.resolve(outcome);
      this.notifySettled(scope, pending.sessionId);
      count += 1;
    }
    if (count > 0) {
      log.warn('approvals', 'settled-pending', { scope, outcome, count });
    }
    return count;
  }

  pendingCount(scope: string, sessionId?: string): number {
    let count = 0;
    for (const pending of this.pending.values()) {
      if (pending.scope === scope && (sessionId === undefined || pending.sessionId === sessionId)) count += 1;
    }
    return count;
  }

  onSettled(scope: string, listener: (sessionId: string | undefined) => void): () => void {
    const listeners = this.settledListeners.get(scope) ?? new Set<(sessionId: string | undefined) => void>();
    listeners.add(listener);
    this.settledListeners.set(scope, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.settledListeners.delete(scope);
    };
  }

  recordToolCall(sessionId: string, callId: string, input: unknown): void {
    this.toolCalls.set(`${sessionId}:${callId}`, input);
  }

  toolInput(sessionId: string, callId: string): unknown {
    return this.toolCalls.get(`${sessionId}:${callId}`);
  }

  clearToolCalls(sessionId: string): void {
    for (const key of this.toolCalls.keys()) {
      if (key.startsWith(`${sessionId}:`)) this.toolCalls.delete(key);
    }
  }

  private notifySettled(scope: string, sessionId: string | undefined): void {
    for (const listener of this.settledListeners.get(scope) ?? []) listener(sessionId);
  }
}
