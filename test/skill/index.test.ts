import { describe, expect, it, vi } from 'vitest';
import { apply, inject, name } from '../../src/skill/index.js';

interface SkillRegistrationLike {
  name: string;
  description: string;
  whenToUse?: string;
  content: string;
  source: 'runtime';
  invocation: { modelInvocable: boolean; userInvocable: boolean };
}

/** Narrow a vitest mock to expose its recorded calls for type-safe access. */
function calls<T>(fn: unknown): T[][] {
  return (fn as { mock: { calls: T[][] } }).mock.calls;
}

describe('dsh-lark-bot/skill entry', () => {
  it('is a cordis plugin that depends on the skills service', () => {
    expect(name).toBe('lark-skill');
    expect(inject).toEqual(['skills']);
  });

  it('registers the model-invocable channel skill on the injected skills service', () => {
    const register = vi.fn(() => () => {});
    const effect = vi.fn();
    const ctx = {
      skills: { register },
      effect,
    } as never;

    apply(ctx);

    const recorded = calls<SkillRegistrationLike>(register);
    expect(recorded.length).toBe(1);
    const registered = recorded[0]![0]!;
    expect(registered.name).toBe('dsh-lark-bot');
    expect(registered.source).toBe('runtime');
    expect(registered.invocation.modelInvocable).toBe(true);
    expect(registered.invocation.userInvocable).toBe(true);
    expect(typeof registered.content).toBe('string');
    expect(registered.content).toContain('dsh-lark-bot channel operations');

    // The dispose returned by register must be wired to the scope lifecycle.
    expect(calls<() => void>(effect).length).toBe(1);
  });

  it('does not throw when the skills service is absent (degraded profile)', () => {
    const ctx = { effect: vi.fn() } as never;
    expect(() => apply(ctx)).not.toThrow();
  });
});
