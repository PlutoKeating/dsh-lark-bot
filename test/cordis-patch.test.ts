import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

describe('cordis.patch.yml', () => {
  it('parses JavaScript-tagged expressions that contain YAML punctuation', async () => {
    const source = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
    const document = parseDocument(source, {
      customTags: [{
        tag: 'tag:yaml.org,2002:js',
        resolve: (value: string) => value,
      }],
    });

    expect(document.errors).toEqual([]);
    expect(source).toContain("scopeConcurrency: !!js 'process.env.DSH_LARK_SCOPE_CONCURRENCY");
  });
});
