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
    await expect(preExecute(edit, allow)).resolves.toMatchObject({ kind: 'deny' });

    await preStep({ agent, turn: 2 }, allow);
    await expect(preExecute(edit, allow)).resolves.toMatchObject({ kind: 'deny' });
  });

  it('allows simple read-only shell inspections without plan approval', async () => {
    let preExecute: (
      execution: { name: string; arguments: unknown; agent?: object },
      next: () => Promise<unknown>,
    ) => Promise<unknown> = async (_execution, next) => next();
    const on = (event: string, listener: unknown): void => {
      if (event === 'tools/pre-execute') preExecute = listener as typeof preExecute;
    };
    apply({
      on,
      tools: {
        register: vi.fn(),
        get: () => ({ presentCall: () => ({ card: 'terminal' }) }),
      },
    } as never);
    const next = vi.fn(async () => ({ kind: 'allow' }));

    for (const command of [
      'date',
      '/usr/bin/date +%F',
      'pwd',
      'ls -la /tmp',
      'rg --files src',
      'find src -name *.ts',
      'git status --short',
      'git log -5 --oneline',
      'git diff --check',
      'git branch --show-current',
      'git remote -v',
      'ps aux',
    ]) {
      await expect(preExecute({ name: 'bash', arguments: { command } }, next)).resolves.toEqual({
        kind: 'allow',
      });
    }
    expect(next).toHaveBeenCalledTimes(12);
  });

  it('keeps mutating, compound, redirected, and unknown shell commands behind the plan gate', async () => {
    let preExecute: (
      execution: { name: string; arguments: unknown; agent?: object },
      next: () => Promise<unknown>,
    ) => Promise<unknown> = async (_execution, next) => next();
    const on = (event: string, listener: unknown): void => {
      if (event === 'tools/pre-execute') preExecute = listener as typeof preExecute;
    };
    apply({
      on,
      tools: {
        register: vi.fn(),
        get: () => ({ presentCall: () => ({ card: 'terminal' }) }),
      },
    } as never);
    const next = vi.fn(async () => ({ kind: 'allow' }));

    for (const command of [
      'rm -rf build',
      'git push fork HEAD',
      'date; rm file',
      'pwd > location.txt',
      'echo $(rm file)',
      'node script.mjs',
      'date --set=tomorrow',
      'rg --pre=./transform pattern',
      'find build -delete',
      'tail -f app.log',
      'git diff --output=changes.patch',
      'git branch new-branch',
      'git remote set-url origin example.invalid/repo',
      './date',
    ]) {
      await expect(preExecute({ name: 'bash', arguments: { command } }, next)).resolves.toMatchObject({
        kind: 'deny',
      });
    }
    expect(next).not.toHaveBeenCalled();
  });

  it('fails closed for background, escalation, and unknown shell arguments', async () => {
    let preExecute: (
      execution: { name: string; arguments: unknown; agent?: object },
      next: () => Promise<unknown>,
    ) => Promise<unknown> = async (_execution, next) => next();
    apply({
      on: (event: string, listener: unknown) => {
        if (event === 'tools/pre-execute') preExecute = listener as typeof preExecute;
      },
      tools: { register: vi.fn() },
    } as never);
    const next = vi.fn(async () => ({ kind: 'allow' }));

    for (const arguments_ of [
      { command: 'date', run_in_background: true },
      { command: 'pwd', sandbox_permissions: 'require_escalated' },
      { command: 'git status', workdir: '/tmp' },
    ]) {
      await expect(preExecute({ name: 'bash', arguments: arguments_ }, next)).resolves.toMatchObject({
        kind: 'deny',
      });
    }
    expect(next).not.toHaveBeenCalled();
  });

  it('supports an explicit environment override for trusted deployments', async () => {
    let preExecute: (
      execution: { name: string; arguments: unknown; agent?: object },
      next: () => Promise<unknown>,
    ) => Promise<unknown> = async (_execution, next) => next();
    apply({
      on: (event: string, listener: unknown) => {
        if (event === 'tools/pre-execute') preExecute = listener as typeof preExecute;
      },
      tools: { register: vi.fn() },
    } as never, { mode: 'off' });
    const next = vi.fn(async () => ({ kind: 'allow' }));

    await expect(preExecute({ name: 'bash', arguments: { command: 'rm file' } }, next))
      .resolves.toEqual({ kind: 'allow' });
  });
});
