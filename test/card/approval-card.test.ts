import { describe, expect, it } from 'vitest';
import { renderApprovalCard } from '../../src/card/approval-card.js';

describe('renderApprovalCard', () => {
  it('renders allow and reject buttons keyed by request id in a column_set row', () => {
    const card = renderApprovalCard({
      id: 'call-1',
      toolName: 'bash',
      reason: 'run tests',
      actionScope: 'chat:member:u1',
      options: [
        { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
      ],
    }) as {
      body: {
        elements: Array<{
          tag: string;
          columns?: Array<{ elements: Array<{ tag: string; value?: Record<string, unknown> }> }>;
        }>;
      };
    };
    expect(card.body.elements.some((element) => element.tag === 'action')).toBe(false);
    const row = card.body.elements.find((element) => element.tag === 'column_set');
    const values =
      row?.columns
        ?.flatMap((column) => column.elements)
        .filter((button) => button.tag === 'button')
        .map((button) => button.value) ?? [];
    expect(values).toContainEqual({
      cmd: 'approve',
      id: 'call-1',
      outcome: 'allow',
      scope: 'chat:member:u1',
    });
    expect(values).toContainEqual({
      cmd: 'approve',
      id: 'call-1',
      outcome: 'reject',
      scope: 'chat:member:u1',
    });
  });

  it('skips the button row when there is nothing to approve or reject', () => {
    const card = renderApprovalCard({
      id: 'call-2',
      toolName: 'bash',
      reason: 'no options',
      options: [],
    }) as { body: { elements: Array<{ tag: string }> } };
    expect(card.body.elements.some((element) => element.tag === 'column_set')).toBe(false);
  });
});
