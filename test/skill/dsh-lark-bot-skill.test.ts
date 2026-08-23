import { describe, expect, it, vi } from 'vitest';
import { DSH_LARK_BOT_SKILL, registerDshLarkBotSkill } from '../../src/skill/dsh-lark-bot.js';

describe('dsh-lark-bot system skill', () => {
  it('is model/user discoverable and covers safe self-configuration boundaries', () => {
    expect(DSH_LARK_BOT_SKILL.name).toBe('dsh-lark-bot');
    expect(DSH_LARK_BOT_SKILL.invocation).toEqual({ modelInvocable: true, userInvocable: true });
    expect(DSH_LARK_BOT_SKILL.content).toContain('/secret');
    expect(DSH_LARK_BOT_SKILL.content).toContain('lark_request_secret');
    expect(DSH_LARK_BOT_SKILL.content).toContain('read the current effective configuration');
    expect(DSH_LARK_BOT_SKILL.content).not.toContain('sk-example');
  });

  it('returns the official registry disposer for plugin unload', () => {
    const dispose = vi.fn();
    const register = vi.fn().mockReturnValue(dispose);
    const lifecycleDisposer = registerDshLarkBotSkill({ register });
    expect(lifecycleDisposer).toBe(dispose);
    expect(register).toHaveBeenCalledWith(DSH_LARK_BOT_SKILL);
    lifecycleDisposer();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
