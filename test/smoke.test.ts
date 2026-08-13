import { describe, expect, it } from 'vitest';
import { packageName } from '../src/index.js';

describe('project bootstrap', () => {
  it('exposes the package name', () => {
    expect(packageName).toBe('dsh-lark-bot');
  });
});
