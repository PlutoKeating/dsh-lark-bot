import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger, redactFields } from '../../src/core/logger.js';

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

describe('recent structured logs', () => {
  it('keeps a bounded in-memory tail that is already redacted', () => {
    const logger = createLogger(new PassThrough(), 2);
    logger.info('test', 'one', { token: 'secret-one' });
    logger.warn('test', 'two', { value: 'safe' });
    logger.error('test', 'three', { value: 'latest' });

    const lines = logger.recent(10);
    expect(lines).toHaveLength(2);
    expect(lines.join('\n')).not.toContain('secret-one');
    expect(lines[0]).toContain('"event":"two"');
    expect(lines[1]).toContain('"event":"three"');
  });
});
