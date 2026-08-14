import { describe, expect, it } from 'vitest';
import { renderApprovalCard } from '../../src/card/approval-card.js';

describe('renderApprovalCard', () => {
  it('renders allow and reject actions keyed by request id', () => {
    const card = renderApprovalCard({
      id: 'call-1',
      toolName: 'bash',
      reason: 'run tests',
      options: [
        { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
      ],
    }) as {
      body: { elements: Array<{ tag: string; actions?: Array<{ value?: Record<string, unknown> }> }> };
    };
    const action = card.body.elements.find((element) => element.tag === 'action');
    const values = action?.actions?.map((button) => button.value) ?? [];
    expect(values).toContainEqual({ cmd: 'approve', id: 'call-1', outcome: 'allow' });
    expect(values).toContainEqual({ cmd: 'approve', id: 'call-1', outcome: 'reject' });
  });
});
