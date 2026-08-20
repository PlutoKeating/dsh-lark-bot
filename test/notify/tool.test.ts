import { afterEach, describe, expect, it, vi } from 'vitest';
import { apply as applyNotifyTool } from '../../src/notify/tool.js';
import type { RawToolDefinition as ToolDefinition } from '../../src/notify/raw-tool.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('lark_notify tool plugin', () => {
  it('registers a tool that posts to the bridge callback endpoint', async () => {
    const registered: ToolDefinition[] = [];
    const ctx = {
      logger: { warn: vi.fn() },
      tools: {
        register: vi.fn((definition: ToolDefinition) => {
          registered.push(definition);
        }),
      },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, chatId: 'oc_group' }),
    });
    globalThis.fetch = fetchMock as never;

    applyNotifyTool(ctx as never, { endpoint: 'http://127.0.0.1:1234/notify', token: 'secret' });

    expect(ctx.tools.register).toHaveBeenCalledOnce();
    const tool = registered[0];
    expect(tool?.name).toBe('lark_notify');
    expect(tool?.parameters).toMatchObject({ type: 'object', required: ['text'] });
    if (!tool) throw new Error('tool was not registered');
    const result = await tool.execute(
      {
        text: 'hello',
        scope: 'chat-a',
        mention_user_ids: ['ou_user1'],
      },
      {} as never,
    );
    expect(result).toEqual({ ok: true, chatId: 'oc_group' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:1234/notify',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          token: 'secret',
          text: 'hello',
          scope: 'chat-a',
          mentions: [{ userId: 'ou_user1' }],
        }),
      }),
    );
  });

  it('validates raw JSON-schema tool arguments without importing dsh-tools', async () => {
    const ctx = { tools: { register: vi.fn() } };
    applyNotifyTool(ctx as never, { endpoint: 'http://127.0.0.1/notify', token: 't' });
    const tool = ctx.tools.register.mock.calls[0]?.[0] as ToolDefinition;
    await expect(tool.execute({ text: 42 }, {})).rejects.toThrow(/text must be/);
  });

  it('throws when the callback endpoint is not configured', async () => {
    const ctx = {
      logger: { warn: vi.fn() },
      tools: { register: vi.fn() },
    };
    applyNotifyTool(ctx as never, {});
    const tool = (ctx.tools.register as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as ToolDefinition;
    await expect(tool.execute({ text: 'x' }, {} as never)).rejects.toThrow('not configured');
  });
});
