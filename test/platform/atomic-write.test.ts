import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeFileAtomic } from '../../src/platform/atomic-write.js';

describe('writeFileAtomic', () => {
  it('creates parent directories and writes the file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-atomic-'));
    const target = join(root, 'nested', 'state.json');

    try {
      await writeFileAtomic(target, '{"ok":true}', { mode: 0o600 });
      expect(await readFile(target, 'utf8')).toBe('{"ok":true}');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
