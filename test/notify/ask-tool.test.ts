import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import { apply as applyAskTool, ASK_TOOL_TIMEOUT_MS } from '../../src/notify/ask-tool.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function toolContext() {
  const registered: ToolDefinition[] = [];
  const ctx = {
    tools: {
      register: vi.fn((definition: ToolDefinition) => {
        registered.push(definition);
      }),
    },
  };
  return { ctx, registered };
}

describe('lark_ask_user tool plugin', () => {
  it('registers a question tool that posts the session id and returns the answer', async () => {
    const { ctx, registered } = toolContext();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, answer: 'use A' }),
    });
    globalThis.fetch = fetchMock as never;

    applyAskTool(ctx as never, {
      endpoint: 'http://127.0.0.1:1234/ask',
      token: 'secret',
    });

    expect(ctx.tools.register).toHaveBeenCalledOnce();
    const tool = registered[0];
    expect(tool?.name).toBe('lark_ask_user');
    expect(tool?.timeoutMs).toBe(ASK_TOOL_TIMEOUT_MS);
    if (!tool) throw new Error('tool was not registered');

    const result = await tool.execute(
      { question: 'Which approach?', options: ['A', 'B'] },
      { agent: { session: { id: 'session-1' } } } as never,
    );

    expect(result).toEqual({ answered: true, answer: 'use A' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:1234/ask',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          token: 'secret',
          sessionId: 'session-1',
          question: 'Which approach?',
          kind: 'single',
          options: ['A', 'B'],
        }),
      }),
    );
  });

  it('defaults to text questions without options', async () => {
    const { ctx, registered } = toolContext();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, answer: '42' }),
    });
    globalThis.fetch = fetchMock as never;
    applyAskTool(ctx as never, { endpoint: 'http://127.0.0.1:1234/ask', token: 't' });
    const tool = registered[0];
    if (!tool) throw new Error('tool was not registered');

    await tool.execute(
      { question: 'How many?' },
      { agent: { session: { id: 'session-2' } } } as never,
    );
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(options.body)).kind).toBe('text');
  });

  it('throws when there is no active session to route the question', async () => {
    const { ctx, registered } = toolContext();
    globalThis.fetch = vi.fn() as never;
    applyAskTool(ctx as never, { endpoint: 'http://127.0.0.1:1234/ask', token: 't' });
    const tool = registered[0];
    if (!tool) throw new Error('tool was not registered');

    await expect(
      tool.execute({ question: 'Q' }, {} as never),
    ).rejects.toThrow(/active session/);
  });

  it('reports failed callbacks instead of throwing', async () => {
    const { ctx, registered } = toolContext();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ ok: false, error: 'unknown session' }),
    }) as never;
    applyAskTool(ctx as never, { endpoint: 'http://127.0.0.1:1234/ask', token: 't' });
    const tool = registered[0];
    if (!tool) throw new Error('tool was not registered');

    const result = await tool.execute(
      { question: 'Q' },
      { agent: { session: { id: 'session-3' } } } as never,
    );
    expect(result).toEqual({ answered: false, error: 'unknown session' });
  });
});
