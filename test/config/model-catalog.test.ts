import { describe, expect, it, vi } from 'vitest';
import { ModelsDevCatalog } from '../../src/config/model-catalog.js';

describe('ModelsDevCatalog', () => {
  it('loads provider/model metadata without hardcoded names or effort levels and caches it', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      vendor: {
        name: 'Vendor Display',
        api: 'https://api.vendor.example/v1',
        env: ['VENDOR_KEY'],
        models: {
          'vision-current': {
            name: 'Vision Current',
            modalities: { input: ['text', 'image'], output: ['text'] },
            limit: { context: 123_000, output: 8_000 },
            reasoning_options: [{ type: 'effort', values: ['tiny', 'large'] }],
          },
        },
      },
    })));
    const catalog = new ModelsDevCatalog({ fetcher, ttlMs: 60_000 });

    const first = await catalog.listProviders();
    const second = await catalog.listProviders();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(first).toEqual([{
      id: 'vendor',
      name: 'Vendor Display',
      api: 'https://api.vendor.example/v1',
      env: ['VENDOR_KEY'],
      models: [{
        id: 'vision-current',
        name: 'Vision Current',
        contextWindow: 123_000,
        maxTokens: 8_000,
        inputModalities: ['text', 'image'],
        reasoningEfforts: ['tiny', 'large'],
      }],
    }]);
  });

  it('keeps the last successful snapshot when refresh fails', async () => {
    let fail = false;
    const fetcher = vi.fn(async () => {
      if (fail) throw new Error('offline');
      return new Response(JSON.stringify({ vendor: { name: 'Vendor', models: {} } }));
    });
    const catalog = new ModelsDevCatalog({ fetcher, ttlMs: 0 });
    expect(await catalog.listProviders()).toHaveLength(1);
    fail = true;
    expect(await catalog.listProviders()).toHaveLength(1);
  });
});
