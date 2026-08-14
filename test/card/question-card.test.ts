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
      }) as { body: { elements: unknown[] } };
      expect(card.body.elements.length).toBeGreaterThan(0);
    }
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
