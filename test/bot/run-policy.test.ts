import { describe, expect, it } from 'vitest';
import { RunPolicyStore } from '../../src/bot/run-policy.js';

describe('RunPolicyStore', () => {
  it('stores and clears per-scope timeout overrides', () => {
    const store = new RunPolicyStore();

    expect(store.get('chat-a')).toBeUndefined();
    store.set('chat-a', 120_000);
    expect(store.get('chat-a')).toBe(120_000);
    expect(store.clear('chat-a')).toBe(true);
    expect(store.get('chat-a')).toBeUndefined();
  });
});
