import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LanguagePolicyStore } from '../../src/bot/language-policy-store.js';

describe('LanguagePolicyStore', () => {
  it('persists CRUD and restores defaults in a 0600 profile file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-language-'));
    try {
      const file = join(root, 'language-policy.json');
      const store = new LanguagePolicyStore(file);
      await store.load();
      expect(store.get()).toEqual({ ui: 'per-viewer', plain: 'bilingual', agent: 'auto' });
      await store.set({ plain: 'en', agent: 'zh' });
      expect(store.get()).toEqual({ ui: 'per-viewer', plain: 'en', agent: 'zh' });
      const restored = new LanguagePolicyStore(file);
      await restored.load();
      expect(restored.get().agent).toBe('zh');
      await restored.reset('agent');
      expect(restored.get().agent).toBe('auto');
      expect((await readFile(file, 'utf8'))).not.toContain('undefined');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
