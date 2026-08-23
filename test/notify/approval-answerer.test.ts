import { afterEach, describe, expect, it, vi } from 'vitest';
import { apply } from '../../src/notify/approval-answerer.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('lark approval answerer', () => {
  it('answers an official approval/request through the bridge callback', async () => {
    let listener: ((request: unknown, next: () => Promise<string>) => Promise<string>) | undefined;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, outcome: 'allowed-once' }),
    });
    globalThis.fetch = fetchMock as never;
    apply({
      on: vi.fn((event: string, value: typeof listener) => {
        if (event === 'approval/request') listener = value;
      }),
      tools: { get: vi.fn() },
    } as never, { endpoint: 'http://127.0.0.1:1234/approval', token: 'secret' });

    const signal = new AbortController().signal;
    const result = await listener?.({
      agent: { session: { id: 'session-1' } },
      toolName: 'bash',
      callId: 'call-1',
      reason: 'Run the requested test suite',
      signal,
    }, async () => 'unavailable');

    expect(result).toBe('allowed-once');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:1234/approval',
      expect.objectContaining({
        method: 'POST',
        signal,
        body: JSON.stringify({
          token: 'secret',
          sessionId: 'session-1',
          toolName: 'bash',
          callId: 'call-1',
          reason: 'Run the requested test suite',
        }),
      }),
    );
  });

  it('returns rejected as a normal decision and fails closed on callback errors', async () => {
    let listener: ((request: unknown, next: () => Promise<string>) => Promise<string>) | undefined;
    const on = (event: string, value: typeof listener): void => {
      if (event === 'approval/request') listener = value;
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        outcome: 'rejected',
        denial: {
          layer: 'permission-policy',
          reason: 'scope policy is deny',
          toChange: 'run /permission ask',
        },
      }),
    }) as never;
    apply({ on, tools: { get: vi.fn() } } as never, { endpoint: 'http://127.0.0.1/approval', token: 't' });
    await expect(listener?.({
      agent: { session: { id: 's' } }, toolName: 'write', reason: 'edit',
    }, async () => 'unavailable')).resolves.toBe('rejected');

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline')) as never;
    await expect(listener?.({
      agent: { session: { id: 's' } }, toolName: 'write', reason: 'edit',
    }, async () => 'unavailable')).resolves.toBe('unavailable');
  });

  it('forces high-risk pre-execute approval and returns rejection as a deny result', async () => {
    let preExecute: ((execution: unknown, next: () => Promise<unknown>) => Promise<unknown>) | undefined;
    const on = (event: string, listener: unknown): void => {
      if (event === 'tools/pre-execute') preExecute = listener as typeof preExecute;
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        outcome: 'rejected',
        denial: {
          layer: 'permission-policy',
          reason: 'scope policy is deny',
          toChange: 'run /permission ask',
        },
      }),
    }) as never;
    apply({
      on,
      tools: { get: () => ({ presentCall: () => ({ card: 'terminal' }) }) },
    } as never, { endpoint: 'http://127.0.0.1/approval', token: 't' });
    const next = vi.fn(async () => ({ kind: 'allow' }));
    await expect(preExecute?.({
      name: 'bash', arguments: { command: 'rm file', description: 'Remove generated file' },
      agent: { session: { id: 's' } },
    }, next)).resolves.toMatchObject({
      kind: 'deny',
      reason: expect.stringContaining('[policy-denial layer=permission-policy]'),
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('consults the scope policy before allowing simple read-only shell inspections', async () => {
    let preExecute: ((execution: unknown, next: () => Promise<unknown>) => Promise<unknown>) | undefined;
    const on = (event: string, listener: unknown): void => {
      if (event === 'tools/pre-execute') preExecute = listener as typeof preExecute;
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        outcome: 'rejected',
        denial: {
          layer: 'permission-policy',
          reason: 'scope policy is deny',
          toChange: 'run /permission ask',
        },
      }),
    });
    globalThis.fetch = fetchMock as never;
    apply({
      on,
      tools: { get: () => ({ presentCall: () => ({ card: 'terminal' }) }) },
    } as never, { endpoint: 'http://127.0.0.1/approval', token: 't' });
    const next = vi.fn(async () => ({ kind: 'allow' }));

    await expect(preExecute?.({
      name: 'bash', arguments: { command: 'git status --short' },
      agent: { session: { id: 's' } },
    }, next)).resolves.toMatchObject({
      kind: 'deny',
      reason: expect.stringContaining('[policy-denial layer=permission-policy]'),
    });
    expect(next).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('allows exactly the approved execution and reuses it for a nested official request', async () => {
    let preExecute: ((execution: unknown, next: () => Promise<unknown>) => Promise<unknown>) | undefined;
    let approval: ((request: unknown, next: () => Promise<string>) => Promise<string>) | undefined;
    const on = (event: string, listener: unknown): void => {
      if (event === 'tools/pre-execute') preExecute = listener as typeof preExecute;
      if (event === 'approval/request') approval = listener as typeof approval;
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, outcome: 'allowed-once' }),
    });
    globalThis.fetch = fetchMock as never;
    apply({
      on,
      tools: { get: () => ({ presentCall: () => ({ kind: 'edit' }) }) },
    } as never, { endpoint: 'http://127.0.0.1/approval', token: 't' });
    const agent = { session: { id: 's' } };
    const result = await preExecute?.(
      { name: 'edit_file', arguments: { path: 'a.ts' }, agent },
      async () => approval?.({ agent, toolName: 'edit_file', callId: 'call-1' }, async () => 'unavailable'),
    );
    expect(result).toBe('allowed-once');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toMatchObject({
      sessionId: 's', toolName: 'edit_file', toolInput: { path: 'a.ts' },
    });
  });
});
