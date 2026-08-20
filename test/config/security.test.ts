import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_DENIED_INTERACTIVE_TOOLS,
  isDeniedTool,
  isEventFresh,
  isPathWithin,
  isSafeHttpUrl,
  redactSecrets,
  truncateUtf8Safe,
} from '../../src/config/security.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('redactSecrets', () => {
  it('redacts bearer tokens, deepseek keys and api_key assignments', () => {
    expect(redactSecrets('Authorization: Bearer abc.def-gh_ij')).toBe(
      'Authorization: [redacted]',
    );
    expect(redactSecrets('key=sk-abcdef1234567890abcdef')).toBe('key=[redacted]');
    expect(redactSecrets('api_key=super-secret-value-12345')).toBe(
      'api_key=[redacted]',
    );
  });

  it('leaves ordinary text untouched', () => {
    expect(redactSecrets('run the tests please')).toBe('run the tests please');
  });
});

describe('isPathWithin', () => {
  it('accepts descendants and rejects escapes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-sec-'));
    tempDirs.push(root);
    expect(isPathWithin(root, join(root, 'a', 'b'))).toBe(true);
    expect(isPathWithin(root, root)).toBe(true);
    expect(isPathWithin(root, join(root, '..', 'outside'))).toBe(false);
  });

  it('accepts a missing descendant through an alias of the same root', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'dsh-sec-alias-'));
    tempDirs.push(parent);
    const root = join(parent, 'root');
    const alias = join(parent, 'root-alias');
    await mkdir(root);
    await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
    expect(isPathWithin(root, join(alias, 'a', 'b'))).toBe(true);
  });

  it('rejects symlink escapes when the target exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-sec-link-'));
    const outside = await mkdtemp(join(tmpdir(), 'dsh-sec-out-'));
    tempDirs.push(root, outside);
    await writeFile(join(outside, 'secret.txt'), 'secret');
    const link = join(root, 'escape');
    await symlink(outside, link);
    expect(isPathWithin(root, join(link, 'secret.txt'))).toBe(false);
    expect(isPathWithin(root, join(link, 'missing.txt'))).toBe(false);
  });
});

describe('truncateUtf8Safe', () => {
  it('truncates by bytes without splitting a character', () => {
    const text = '你好，世界！hello';
    const cut = truncateUtf8Safe(text, 6);
    expect(Buffer.byteLength(cut, 'utf8')).toBeLessThanOrEqual(6);
    expect([...cut].every((char) => !isSurrogateSplit(cut, char))).toBe(true);
  });

  it('returns the input when it already fits', () => {
    expect(truncateUtf8Safe('abc', 100)).toBe('abc');
  });
});

function isSurrogateSplit(text: string, char: string): boolean {
  const index = text.indexOf(char);
  const code = text.charCodeAt(index);
  return code >= 0xd800 && code <= 0xdfff;
}

describe('isEventFresh', () => {
  it('rejects stale events and accepts fresh ones', () => {
    const now = 1_000_000;
    expect(isEventFresh(now - 5_000, 10_000, now)).toBe(true);
    expect(isEventFresh(now - 60_000, 10_000, now)).toBe(false);
    expect(isEventFresh(undefined, 10_000, now)).toBe(true);
  });
});

describe('denied tools', () => {
  it('defaults to denying interactive tools', () => {
    expect(DEFAULT_DENIED_INTERACTIVE_TOOLS.length).toBeGreaterThan(0);
    expect(isDeniedTool('ask_user_question')).toBe(true);
    expect(isDeniedTool('bash')).toBe(false);
  });
});

describe('isSafeHttpUrl', () => {
  it('accepts public https urls', () => {
    expect(isSafeHttpUrl('https://api.deepseek.com/v1')).toBe(true);
    expect(isSafeHttpUrl('http://example.com')).toBe(true);
  });

  it('rejects private, loopback and link-local addresses', () => {
    expect(isSafeHttpUrl('http://localhost:8080/x')).toBe(false);
    expect(isSafeHttpUrl('http://127.0.0.1/x')).toBe(false);
    expect(isSafeHttpUrl('http://10.0.0.1/x')).toBe(false);
    expect(isSafeHttpUrl('http://192.168.1.1/x')).toBe(false);
    expect(isSafeHttpUrl('http://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isSafeHttpUrl('http://[::1]/x')).toBe(false);
    expect(isSafeHttpUrl('ftp://example.com/x')).toBe(false);
  });
});
