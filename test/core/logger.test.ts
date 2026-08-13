import { describe, expect, it } from 'vitest';
import { redactFields } from '../../src/core/logger.js';

describe('redactFields', () => {
  it('redacts secret-like keys at any supported depth', () => {
    const redacted = redactFields({
      safe: 'visible',
      appSecret: 'cli_secret',
      nested: {
        token: 'abc',
        count: 1,
      },
    });

    expect(redacted).toEqual({
      safe: 'visible',
      appSecret: '[redacted]',
      nested: {
        token: '[redacted]',
        count: 1,
      },
    });
  });
});
