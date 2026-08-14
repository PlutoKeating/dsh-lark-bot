import { describe, expect, it, vi } from 'vitest';
import { apply as applyInvariant } from '../src/invariant.js';

describe('dsh-lark-bot invariant companion', () => {
  it('registers package ownership with the host invariants registry', async () => {
    const register = vi.fn().mockReturnValue(() => {});
    const ctx = {
      get: (name: string) => (name === 'invariants' ? { register } : undefined),
    };
    const disposer = await applyInvariant(ctx as never);
    expect(register).toHaveBeenCalledWith('dsh-lark-bot', expect.any(Function));
    expect(typeof disposer).toBe('function');
  });

  it('fails fast when the invariants service is absent', async () => {
    const ctx = { get: () => undefined };
    expect(() => applyInvariant(ctx as never)).toThrow('invariants');
  });
});
