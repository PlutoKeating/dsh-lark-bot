import { describe, expect, it } from 'vitest';
import {
  extractQuestionAnswer,
  renderQuestionCard,
} from '../../src/card/question-card.js';

describe('question cards', () => {
  it('renders text, single and multi variants', () => {
    for (const kind of ['text', 'single', 'multi'] as const) {
      const card = renderQuestionCard({
        id: 'q-1',
        kind,
        question: 'Pick one',
        options: ['a', 'b'],
      }) as {
        body: {
          elements: Array<{ tag: string; elements?: unknown[]; actions?: unknown[] }>;
        };
      };
      expect(card.body.elements.length).toBeGreaterThan(0);
      expect(card.body.elements.some((element) => element.tag === 'action')).toBe(false);
      const form = card.body.elements.find((element) => element.tag === 'form');
      expect(form?.elements).toBeDefined();
    }
  });

  it('wraps the input and submit button in a form for schema 2.0', () => {
    const card = renderQuestionCard({
      id: 'q-2',
      kind: 'text',
      question: 'Why?',
      actionScope: 'chat:member:u1',
    });
    const content = JSON.stringify(card);
    expect(content).toContain('"tag":"form"');
    expect(content).toContain('"form_action_type":"submit"');
    expect(content).toContain('"cmd":"question-submit","id":"q-2"');
    expect(content).toContain('"scope":"chat:member:u1"');
    expect(content).not.toContain('"tag":"action"');
  });

  it('extracts single-choice answers back to labels', () => {
    expect(extractQuestionAnswer('single', 'option-1', ['red', 'blue'])).toBe('blue');
    expect(extractQuestionAnswer('multi', ['option-0', 'option-1'], ['red', 'blue'])).toEqual([
      'red',
      'blue',
    ]);
    expect(extractQuestionAnswer('text', '  hello  ')).toBe('hello');
    expect(extractQuestionAnswer('text', '   ')).toBeUndefined();
    expect(extractQuestionAnswer('single', undefined, ['red'])).toBeUndefined();
  });
});
