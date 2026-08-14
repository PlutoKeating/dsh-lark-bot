import type { ApprovalOutcome, ApprovalRequest } from '../adapters/types.js';
import { log } from '../core/logger.js';

interface PendingApproval {
  request: ApprovalRequest;
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

  register(scope: string, request: ApprovalRequest): Promise<ApprovalOutcome> {
    const key = `${scope}:${request.id}`;
    const existing = this.pending.get(key);
    if (existing) return Promise.resolve('cancelled');
    return new Promise<ApprovalOutcome>((resolve) => {
      this.pending.set(key, { request, resolve, settled: false });
    });
  }

  resolve(scope: string, id: string, outcome: ApprovalOutcome): boolean {
    const key = `${scope}:${id}`;
    const pending = this.pending.get(key);
    if (!pending || pending.settled) return false;
    pending.settled = true;
    this.pending.delete(key);
    pending.resolve(outcome);
    return true;
  }

  /** Settle every pending approval for a scope (run end / dispose). */
  settleAll(scope: string, outcome: ApprovalOutcome): number {
    let count = 0;
    for (const [key, pending] of this.pending) {
      if (!key.startsWith(`${scope}:`)) continue;
      if (pending.settled) continue;
      pending.settled = true;
      this.pending.delete(key);
      pending.resolve(outcome);
      count += 1;
    }
    if (count > 0) {
      log.warn('approvals', 'settled-pending', { scope, outcome, count });
    }
    return count;
  }

  pendingCount(scope: string): number {
    let count = 0;
    for (const key of this.pending.keys()) {
      if (key.startsWith(`${scope}:`)) count += 1;
    }
    return count;
  }
}
