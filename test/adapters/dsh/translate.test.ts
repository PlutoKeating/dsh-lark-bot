import { describe, expect, it } from 'vitest';
import {
  plainOutputEvent,
  translateDshLine,
} from '../../../src/adapters/dsh/translate.js';

describe('dsh output translation', () => {
  it('maps jsonl agent events', () => {
    expect(translateDshLine('{"type":"text","delta":"hi"}')).toEqual([
      { type: 'text', delta: 'hi' },
    ]);
    expect(
      translateDshLine('{"type":"tool_use","id":"1","name":"bash","input":{"command":"ls"}}'),
    ).toEqual([
      { type: 'tool_use', id: '1', name: 'bash', input: { command: 'ls' } },
    ]);
  });

  it('turns plain stdout into final text', () => {
    expect(plainOutputEvent('hello dsh')).toEqual([
      { type: 'final_text', content: 'hello dsh' },
    ]);
  });
});
