import { describe, expect, it, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { attachOptionalTuiSeams } from '../../src/tui/optional-seams.js';

describe('optional dsh-TUI seams', () => {
  it('is a no-op when TUI is absent', () => {
    const ctx = { get: vi.fn(() => undefined) } as unknown as Context;
    expect(() => attachOptionalTuiSeams(ctx)()).not.toThrow();
  });

  it('discovers each live descriptor without caching Presentation and releases status on deactivate', () => {
    const dispose = vi.fn();
    const set = vi.fn(() => dispose);
    const descriptor = vi.fn(() => ({ runtime: { generationId: 'generation-a' } }));
    const ctx = {
      get: vi.fn((name: string) => name === 'tuiPluginHost' ? { descriptor } : name === 'tuiStatus' ? { set } : undefined),
    } as unknown as Context;
    const detach = attachOptionalTuiSeams(ctx);
    expect(descriptor).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith('dsh-lark-bot:bridge', '飞书桥接已加载');
    detach();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('fails soft when an optional seam throws', () => {
    const ctx = {
      get: vi.fn((name: string) => name === 'tuiPluginHost'
        ? { descriptor: () => { throw new Error('host unavailable'); } }
        : undefined),
    } as unknown as Context;
    expect(() => attachOptionalTuiSeams(ctx)()).not.toThrow();
  });

  it('uses each activation generation independently and cleans both resources', () => {
    const disposeA = vi.fn();
    const disposeB = vi.fn();
    const descriptorA = vi.fn(() => ({ runtime: { generationId: 'generation-a', location: 'local' } }));
    const descriptorB = vi.fn(() => ({ runtime: { generationId: 'generation-b', location: 'remote' } }));
    const context = (descriptor: () => unknown, dispose: () => void) => ({
      get: vi.fn((name: string) => name === 'tuiPluginHost'
        ? { descriptor }
        : name === 'tuiStatus'
          ? { set: () => dispose }
          : undefined),
    }) as unknown as Context;
    const detachA = attachOptionalTuiSeams(context(descriptorA, disposeA));
    const detachB = attachOptionalTuiSeams(context(descriptorB, disposeB));
    expect(descriptorA).toHaveBeenCalledOnce();
    expect(descriptorB).toHaveBeenCalledOnce();
    detachB();
    detachA();
    expect(disposeA).toHaveBeenCalledOnce();
    expect(disposeB).toHaveBeenCalledOnce();
  });
});
