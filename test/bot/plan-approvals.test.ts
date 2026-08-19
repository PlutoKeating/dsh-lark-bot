import { describe, expect, it, vi } from 'vitest';
import { PlanApprovalRegistry } from '../../src/bot/plan-approvals.js';

describe('PlanApprovalRegistry', () => {
  it('resolves one decision with optional feedback', async () => {
    const plans = new PlanApprovalRegistry();
    const settled = vi.fn();
    plans.onSettled('chat-a', settled);
    const pending = plans.register('chat-a', 'session-a');
    expect(plans.pendingCount('chat-a')).toBe(1);
    expect(plans.resolve('chat-a', pending.id, {
      decision: 'revise',
      feedback: 'do not edit files yet',
    })).toBe(true);
    await expect(pending.promise).resolves.toEqual({
      decision: 'revise',
      feedback: 'do not edit files yet',
    });
    expect(settled).toHaveBeenCalledOnce();
  });

  it('cancels only pending gates owned by one session', async () => {
    const plans = new PlanApprovalRegistry();
    const first = plans.register('chat-a', 'session-a');
    const second = plans.register('chat-a', 'session-b');
    expect(plans.settleSession('chat-a', 'session-a')).toBe(1);
    await expect(first.promise).resolves.toBeUndefined();
    expect(plans.pendingCount('chat-a', 'session-b')).toBe(1);
    plans.resolve('chat-a', second.id, { decision: 'approved' });
    await expect(second.promise).resolves.toEqual({ decision: 'approved' });
  });

  it('does not confuse prefix-related group and member scopes', async () => {
    const plans = new PlanApprovalRegistry();
    const member = plans.register('chat-a:member:u1', 'session-member');
    expect(plans.pendingCount('chat-a')).toBe(0);
    expect(plans.settleSession('chat-a', 'session-member')).toBe(0);
    expect(plans.pendingCount('chat-a:member:u1')).toBe(1);
    plans.resolve('chat-a:member:u1', member.id, { decision: 'approved' });
    await expect(member.promise).resolves.toEqual({ decision: 'approved' });
  });
});
