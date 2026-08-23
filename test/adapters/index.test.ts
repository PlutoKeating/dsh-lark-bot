import { describe, expect, it, vi } from 'vitest';
import { resolveAdapterRoute } from '../../src/adapters/index.js';

describe('resolveAdapterRoute', () => {
  it('falls back to the object-form dsh default when provider and model are empty', async () => {
    const defaultModelSelection = vi.fn().mockResolvedValue({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash-vision-exp',
    });

    await expect(resolveAdapterRoute(
      { provider: '', model: '' },
      { defaultModelSelection },
    )).resolves.toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash-vision-exp',
    });
    expect(defaultModelSelection).toHaveBeenCalledOnce();
  });

  it('preserves an explicit provider/model route without consulting dsh defaults', async () => {
    const defaultModelSelection = vi.fn();
    await expect(resolveAdapterRoute(
      { provider: 'gateway', model: 'model-a' },
      { defaultModelSelection },
    )).resolves.toEqual({ provider: 'gateway', model: 'model-a' });
    expect(defaultModelSelection).not.toHaveBeenCalled();
  });
});
