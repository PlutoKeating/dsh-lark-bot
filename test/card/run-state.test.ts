import { describe, expect, it } from 'vitest';
import {
  initialState,
  markInterrupted,
  reduce,
} from '../../src/card/run-state.js';

describe('run state reducer', () => {
  it('streams text deltas into the same block', () => {
    const state = reduce(
      reduce(initialState, { type: 'text', delta: 'hello' }),
      { type: 'text', delta: ' world' },
    );

    expect(state.blocks).toEqual([
      { kind: 'text', content: 'hello world', streaming: true },
    ]);
    expect(state.footer).toBe('streaming');
  });

  it('marks interrupted runs as terminal', () => {
    const state = markInterrupted(
      reduce(initialState, { type: 'text', delta: 'partial' }),
    );

    expect(state.terminal).toBe('interrupted');
    expect(state.footer).toBeNull();
  });
});
