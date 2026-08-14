import { describe, expect, it, vi } from 'vitest';
import { apply as applyBridgePlugin, LarkBridgeService } from '../src/plugin.js';
import type { ServiceManager } from '../src/service/manager.js';

function makeCtx() {
  const provided: Record<string, unknown> = {};
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn() },
    reflect: {
      provide: (name: string, value: unknown) => {
        provided[name] = value;
        return () => {};
      },
    },
  };
  return { ctx, provided };
}

describe('dsh-lark-bot bundle plugin', () => {
  it('registers the larkBridge service and logs a friendly banner', () => {
    const { ctx, provided } = makeCtx();
    const status = vi.fn().mockResolvedValue({ state: 'stopped' });
    const manager = { status } as unknown as ServiceManager;

    applyBridgePlugin(ctx as never, { profile: 'default' }, manager);

    expect(provided.larkBridge).toBeInstanceOf(LarkBridgeService);
    expect(ctx.logger.info).toHaveBeenCalledWith(expect.stringContaining('bundle loaded'));
    void (provided.larkBridge as LarkBridgeService).status().then((value: unknown) => {
      expect(value).toEqual({ state: 'stopped' });
    });
  });

  it('autostarts the bridge when configured', async () => {
    const { ctx } = makeCtx();
    const start = vi.fn().mockResolvedValue({ state: 'running' });
    const manager = { start } as unknown as ServiceManager;

    applyBridgePlugin(ctx as never, { profile: 'default', autostart: true }, manager);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(start).toHaveBeenCalledOnce();
  });
});
