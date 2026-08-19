import { afterEach, describe, expect, it, vi } from 'vitest';
import { apply } from '../../src/notify/plan-tool.js';
import type { RawToolDefinition } from '../../src/notify/raw-tool.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('lark_request_plan_approval tool', () => {
  it('posts the complete plan and returns the human decision', async () => {
    const definitions: RawToolDefinition[] = [];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, decision: 'approved', feedback: 'ship it' }),
    });
    globalThis.fetch = fetchMock as never;
    apply({
      on: vi.fn(),
      tools: { register: (definition: RawToolDefinition) => definitions.push(definition) },
    } as never, {
      endpoint: 'http://127.0.0.1:1234/plan',
      token: 'secret',
    });
    const tool = definitions[0];
    expect(tool?.name).toBe('lark_request_plan_approval');
    expect(tool?.timeoutMs).toBeUndefined();
    if (!tool) throw new Error('tool missing');

    await expect(tool.execute(
      { plan: '1. inspect\n2. edit' },
      { agent: { session: { id: 'session-1' } } } as never,
    )).resolves.toEqual({ resolved: true, decision: 'approved', feedback: 'ship it' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:1234/plan',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          token: 'secret',
          sessionId: 'session-1',
          plan: '1. inspect\n2. edit',
        }),
      }),
    );
  });

  it('requires an active session', async () => {
    const definitions: RawToolDefinition[] = [];
    apply({
      on: vi.fn(),
      tools: { register: (definition: RawToolDefinition) => definitions.push(definition) },
    } as never, {
      endpoint: 'http://127.0.0.1:1234/plan',
      token: 'secret',
    });
    await expect(definitions[0]!.execute({ plan: 'Plan' }, {} as never)).rejects.toThrow(
      'active session',
    );
  });

  it('denies mutating tools until the current turn plan is approved', async () => {
    const definitions: RawToolDefinition[] = [];
    let preStep: (
      payload: { agent: object; turn: number },
      next: () => Promise<unknown>,
    ) => Promise<unknown> = async (_payload, next) => next();
    let preExecute: (
      execution: { name: string; arguments: unknown; agent?: object },
      next: () => Promise<unknown>,
    ) => Promise<unknown> = async (_execution, next) => next();
    const on = (event: string, listener: unknown): void => {
      if (event === 'agent/pre-step') preStep = listener as typeof preStep;
      if (event === 'tools/pre-execute') preExecute = listener as typeof preExecute;
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, decision: 'approved' }),
    }) as never;
    apply({
      on,
      tools: {
        register: (definition: RawToolDefinition) => definitions.push(definition),
        get: () => ({ presentCall: () => ({ kind: 'edit' }) }),
      },
    } as never, { endpoint: 'http://127.0.0.1:1234/plan', token: 'secret' });
    const agent = { session: { id: 'session-1' } };
    const edit = { name: 'edit_file', arguments: { path: 'a.ts' }, agent };
    const allow = async (): Promise<unknown> => ({ kind: 'allow' });

    await preStep({ agent, turn: 1 }, allow);
    await expect(preExecute(edit, allow)).resolves.toMatchObject({ kind: 'deny' });
    await definitions[0]!.execute({ plan: 'Edit a.ts' }, { agent } as never);
    await expect(preExecute(edit, allow)).resolves.toEqual({ kind: 'allow' });

    await preStep({ agent, turn: 2 }, allow);
    await expect(preExecute(edit, allow)).resolves.toMatchObject({ kind: 'deny' });
  });
});
