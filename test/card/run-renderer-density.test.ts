import { describe, expect, it } from 'vitest';
import { initialState, reduce, type RunState } from '../../src/card/run-state.js';
import { renderCard } from '../../src/card/run-renderer.js';

function finishedState(): RunState {
  let state = reduce(initialState, {
    type: 'thinking',
    delta: 'let me check the docs…',
  });
  state = reduce(state, { type: 'text', delta: 'The answer is 42.' });
  state = reduce(state, { type: 'usage', inputTokens: 10, outputTokens: 20 });
  state = reduce(state, { type: 'done', sessionId: 's1', terminationReason: 'normal' });
  return state;
}

describe('renderCard densities', () => {
  it('renders compact, standard and detailed variants', () => {
    const state = finishedState();
    const compact = renderCard(state, 'compact') as { body: { elements: unknown[] } };
    const standard = renderCard(state, 'standard') as { body: { elements: unknown[] } };
    const detailed = renderCard(state, 'detailed') as { body: { elements: unknown[] } };
    const compactJson = JSON.stringify(compact);
    const standardJson = JSON.stringify(standard);
    const detailedJson = JSON.stringify(detailed);
    expect(compactJson).not.toContain('tokens');
    expect(standardJson).toContain('tokens');
    expect(detailedJson.length).toBeGreaterThanOrEqual(standardJson.length);
  });

  it('keeps a running card interactive with a stop button', () => {
    const state = reduce(initialState, { type: 'thinking', delta: '…' });
    const card = renderCard(state, 'compact') as {
      config: { streaming_mode?: boolean };
      body: { elements: Array<{ tag: string }> };
    };
    expect(card.config.streaming_mode).toBe(true);
    expect(card.body.elements.some((element) => element.tag === 'button')).toBe(true);
  });

  it('includes token usage in the detailed view', () => {
    const card = renderCard(finishedState(), 'detailed') as {
      body: { elements: Array<{ content?: string }> };
    };
    expect(
      card.body.elements.some((element) => element.content?.includes('tokens')),
    ).toBe(true);
  });
});
