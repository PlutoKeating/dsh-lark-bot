import { describe, expect, it } from 'vitest';
import { initialState, reduce } from '../../src/card/run-state.js';
import { renderCard } from '../../src/card/run-renderer.js';

describe('renderCard', () => {
  it('emits a streaming card while running', () => {
    const card = renderCard(
      reduce(initialState, { type: 'text', delta: 'thinking' }),
    ) as { config: { streaming_mode: boolean }; body: { elements: unknown[] } };

    expect(card.config.streaming_mode).toBe(true);
    expect(card.body.elements.some((element) => JSON.stringify(element).includes('终止'))).toBe(true);
  });

  it('shows elapsed time and a stall hint while running', () => {
    const now = 1_000_000;
    const state = {
      ...initialState,
      startedAtMs: now - 65_000,
      lastActivityMs: now - 65_000,
    };
    const card = renderCard(state, 'standard', now) as { body: { elements: unknown[] } };
    const text = JSON.stringify(card.body.elements);
    expect(text).toContain('⏱ 65s');
    expect(text).toContain('无响应 65s');
  });
});
