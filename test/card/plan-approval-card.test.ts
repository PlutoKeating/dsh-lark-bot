import { describe, expect, it } from 'vitest';
import { renderPlanApprovalCard } from '../../src/card/plan-approval-card.js';

describe('renderPlanApprovalCard', () => {
  it('renders feedback plus approve and revise submit actions bound to scope', () => {
    const card = renderPlanApprovalCard({ id: 'plan-1', actionScope: 'chat:member:u1' });
    const content = JSON.stringify(card);
    expect(content).toContain('批准，开始执行');
    expect(content).toContain('继续规划');
    expect(content).toContain('"name":"feedback"');
    expect(content).toContain('"decision":"approved","scope":"chat:member:u1"');
    expect(content).toContain('"decision":"revise","scope":"chat:member:u1"');
    expect(content).toContain('"form_action_type":"submit"');
    expect(content).toContain('"behaviors":[{"type":"callback","value":{"cmd":"plan-submit"');
  });
});
