import { describe, expect, it } from 'vitest';
import { resolveModelChoice } from '../../src/adapters/model-choice.js';

describe('resolveModelChoice', () => {
  it('falls back to the env model when the preference is blank (issue #112 Bug C)', () => {
    expect(resolveModelChoice('', 'deepseek-v4-flash')).toBe('deepseek-v4-flash');
    expect(resolveModelChoice('   ', 'deepseek-v4-flash')).toBe('deepseek-v4-flash');
    expect(resolveModelChoice(undefined, 'deepseek-v4-flash')).toBe('deepseek-v4-flash');
  });

  it('prefers a non-blank preference', () => {
    expect(resolveModelChoice('deepseek-v4-flash', 'env-model')).toBe('deepseek-v4-flash');
  });

  it('returns the env model unchanged when both are blank', () => {
    expect(resolveModelChoice('', '')).toBe('');
  });
});
