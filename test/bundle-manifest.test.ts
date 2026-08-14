import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('dsh bundle manifest', () => {
  it('declares dsh.bundle.patch, plugin/invariant/notify exports and cordis peer', async () => {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      dsh?: { bundle?: { patch?: string } };
      exports?: Record<string, unknown>;
      files?: string[];
      peerDependencies?: Record<string, string>;
    };
    expect(pkg.dsh?.bundle?.patch).toBe('./cordis.patch.yml');
    expect(pkg.exports?.['./plugin']).toBeDefined();
    expect(pkg.exports?.['./invariant']).toBeDefined();
    expect(pkg.exports?.['./notify']).toBeDefined();
    expect(pkg.files).toContain('cordis.patch.yml');
    expect(pkg.peerDependencies?.['@deepseek-ai/cordis']).toMatch(/^(\^|>=)/);
  });

  it('ships a bundle patch whose row references the plugin entry', async () => {
    const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
    expect(patch).toContain("name: 'dsh-lark-bot/plugin'");
    expect(patch).toContain('id: dsh-lark-bot');
    expect(patch).toContain('DSH_LARK_AUTOSTART');
  });
});
