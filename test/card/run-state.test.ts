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

  it('renders committed final text even when no streaming deltas were emitted', () => {
    const state = reduce(initialState, {
      type: 'final_text',
      content: 'hello from dsh',
    });

    expect(state.blocks).toEqual([
      { kind: 'text', content: 'hello from dsh', streaming: false },
    ]);
  });

  it('coalesces repeated updates for the same tool call', () => {
    let state = reduce(initialState, {
      type: 'tool_use',
      id: 'tool-1',
      name: 'read',
      input: '',
    });
    state = reduce(state, {
      type: 'tool_use',
      id: 'tool-1',
      name: 'read',
      input: { path: 'src/index.ts' },
    });
    state = reduce(state, {
      type: 'tool_result',
      id: 'tool-1',
      output: 'file contents',
      isError: false,
    });
    state = reduce(state, {
      type: 'tool_use',
      id: 'tool-1',
      name: 'read_file',
      input: { path: 'src/index.ts' },
    });

    expect(state.blocks).toEqual([
      {
        kind: 'tool',
        tool: {
          id: 'tool-1',
          name: 'read_file',
          input: { path: 'src/index.ts' },
          status: 'done',
          output: 'file contents',
        },
      },
    ]);
  });
});
