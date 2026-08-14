import { describe, expect, it } from 'vitest';
import { CARD_DENSITIES, parseCardDensity } from '../../src/card/density.js';

describe('parseCardDensity', () => {
  it('parses the three densities case-insensitively', () => {
    expect(CARD_DENSITIES).toEqual(['compact', 'standard', 'detailed']);
    expect(parseCardDensity('compact')).toBe('compact');
    expect(parseCardDensity('DETAILED')).toBe('detailed');
    expect(parseCardDensity('standard')).toBe('standard');
  });

  it('returns undefined for unknown values', () => {
    expect(parseCardDensity('huge')).toBeUndefined();
    expect(parseCardDensity('')).toBeUndefined();
  });
});
