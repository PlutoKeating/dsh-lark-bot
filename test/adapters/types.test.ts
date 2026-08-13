import { describe, expect, it } from 'vitest';
import { isTerminalEvent } from '../../src/adapters/types.js';

describe('agent event contract', () => {
  it('recognizes terminal events', () => {
    expect(isTerminalEvent({ type: 'done', terminationReason: 'normal' })).toBe(true);
    expect(isTerminalEvent({ type: 'error', message: 'x', terminationReason: 'failed' })).toBe(true);
    expect(isTerminalEvent({ type: 'text', delta: 'x' })).toBe(false);
  });
});
