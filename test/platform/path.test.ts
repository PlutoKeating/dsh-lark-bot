import { describe, expect, it } from 'vitest';
import { sanitizeServicePath } from '../../src/platform/path.js';

describe('sanitizeServicePath', () => {
  it('prepends the node bin dir and drops transient npm/npx bins', () => {
    const path = sanitizeServicePath('/opt/node/bin/node', [
      '/tmp/guardian/update-worker/npm-cache/request/_npx/hash/node_modules/.bin',
      '/workspace/node_modules/.bin',
      '/opt/node/bin',
      '/home/user/.local/bin',
      '/usr/bin',
      '/home/user/.local/bin',
    ].join(':'));

    expect(path).toBe('/opt/node/bin:/home/user/.local/bin:/usr/bin');
    expect(path).not.toContain('_npx');
    expect(path).not.toContain('node_modules/.bin');
  });

  it('leaves a clean path intact (only the bin dir is prepended)', () => {
    expect(sanitizeServicePath('/usr/local/bin/node', '/usr/local/bin:/usr/bin')).toBe(
      '/usr/local/bin:/usr/bin',
    );
  });

  it('defaults to process.env.PATH when no inherited path is given', () => {
    const previous = process.env.PATH;
    process.env.PATH = '/custom/bin:/usr/bin';
    try {
      expect(sanitizeServicePath('/opt/node/bin/node')).toBe('/opt/node/bin:/custom/bin:/usr/bin');
    } finally {
      process.env.PATH = previous;
    }
  });
});
