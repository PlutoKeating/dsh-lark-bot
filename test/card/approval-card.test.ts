import { describe, expect, it } from 'vitest';
import { renderApprovalCard } from '../../src/card/approval-card.js';

describe('renderApprovalCard', () => {
  it('renders allow and reject buttons keyed by request id in a column_set row', () => {
    const card = renderApprovalCard({
      id: 'call-1',
      toolName: 'bash',
      reason: 'run tests',
      toolInput: { command: 'pnpm test', cwd: '/workspace' },
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
    expect(JSON.stringify(card)).toContain('pnpm test');
    expect(JSON.stringify(card)).toContain('run tests');
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

  it('redacts secrets and truncates multibyte card text by UTF-8 bytes', () => {
    const card = renderApprovalCard({
      id: 'approval-safe', toolName: 'bash',
      reason: `Use Bearer abcdefghijklmnop ${'理由'.repeat(1200)}`,
      toolInput: { command: `curl -H 'Authorization: Bearer secret-token-12345' ${'你'.repeat(2000)}` },
      options: [],
    });
    const serialized = JSON.stringify(card);
    expect(serialized).not.toContain('abcdefghijklmnop');
    expect(serialized).not.toContain('secret-token-12345');
    expect(serialized).toContain('[redacted]');
    expect(serialized).toContain('已截断');
    expect(serialized).not.toContain('\ud800');
  });
});
