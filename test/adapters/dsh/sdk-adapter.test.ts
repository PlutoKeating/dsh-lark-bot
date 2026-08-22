import { describe, expect, it, vi } from 'vitest';
import type { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client';
import {
  SdkDshAdapter,
  type ModelRoute,
} from '../../../src/adapters/dsh/sdk-adapter.js';

function fakeHarness(route?: ModelRoute): DeepSeekHarness {
  const close = vi.fn().mockResolvedValue(undefined);
  const harness = {
    route,
    close,
    run: async (_input: string, options?: { sessionId?: string; onNotification?: (n: unknown) => void }) => {
      options?.onNotification?.({
        method: 'session.event',
        params: { sessionId: options?.sessionId, event: { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: 'ok' } } } },
      });
      return { sessionId: options?.sessionId, finalResponse: 'ok', events: [], notifications: [] };
    },
    start: async () => undefined,
    session: () => ({ run: harness.run }),
    client: undefined as never,
    [Symbol.asyncDispose]: async () => undefined,
  } as unknown as DeepSeekHarness;
  return harness;
}

describe('SdkDshAdapter', () => {
  it('runs a prompt through a scoped harness and reuses sessions', async () => {
    const created: string[] = [];
    const adapter = new SdkDshAdapter({
      launch: { command: 'node', args: ['bin.js', '--profile', 'dsh-lark'], profile: 'dsh-lark' },
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      harnessFactory: (cwd) => {
        created.push(cwd);
        return fakeHarness();
      },
    });

    const run = adapter.run({
      runId: 'r1',
      prompt: 'hi',
      cwd: '/tmp/a',
      sessionId: 'session-1',
      model: undefined,
      images: undefined,
      stopGraceMs: undefined,
    });
    const events = [];
    for await (const event of run.events) events.push(event);

    expect(created).toEqual(['/tmp/a']);
    expect(events.at(-1)).toMatchObject({ type: 'done', sessionId: 'session-1' });
    expect(events.map((event) => event.type)).toContain('text');
  });

  it('closes the runtime on stop and on dispose', async () => {
    const harness = fakeHarness();
    const adapter = new SdkDshAdapter({
      launch: { command: 'node', args: ['bin.js', '--profile', 'dsh-lark'], profile: 'dsh-lark' },
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      harnessFactory: () => harness,
    });

    const run = adapter.run({
      runId: 'r2',
      prompt: 'hi',
      cwd: '/tmp/b',
      sessionId: undefined,
      model: undefined,
      images: undefined,
      stopGraceMs: undefined,
    });
    await run.stop();
    expect(harness.close).toHaveBeenCalled();

    adapter.run({
      runId: 'r3',
      prompt: 'hi',
      cwd: '/tmp/c',
      sessionId: undefined,
      model: undefined,
      images: undefined,
      stopGraceMs: undefined,
    });
    await adapter.dispose();
    expect(harness.close).toHaveBeenCalledTimes(2);
  });

  it('stopping one scope does not close another scope runtime in the same cwd', async () => {
    const created: DeepSeekHarness[] = [];
    const adapter = new SdkDshAdapter({
      launch: { command: 'node', args: ['bin.js', '--profile', 'dsh-lark'], profile: 'dsh-lark' },
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      harnessFactory: () => {
        const harness = fakeHarness();
        created.push(harness);
        return harness;
      },
    });

    const runA = adapter.run({
      runId: 'scope-a-run',
      runtimeKey: 'scope-a\0/tmp/shared',
      prompt: 'task a',
      cwd: '/tmp/shared',
      sessionId: undefined,
      model: undefined,
      images: undefined,
      stopGraceMs: undefined,
    });
    const runB = adapter.run({
      runId: 'scope-b-run',
      runtimeKey: 'scope-b\0/tmp/shared',
      prompt: 'task b',
      cwd: '/tmp/shared',
      sessionId: undefined,
      model: undefined,
      images: undefined,
      stopGraceMs: undefined,
    });

    expect(created).toHaveLength(2);
    await runA.stop();
    expect(created[0]?.close).toHaveBeenCalledTimes(1);
    expect(created[1]?.close).not.toHaveBeenCalled();

    void runA.events;
    void runB.events;
    await adapter.dispose();
  });

  it('gives concurrent runs with the same stale binding independent runtimes and session ids', async () => {
    const created: DeepSeekHarness[] = [];
    let settleFirst: (() => void) | undefined;
    const adapter = new SdkDshAdapter({
      launch: { command: 'node', args: ['bin.js', '--profile', 'dsh-lark'], profile: 'dsh-lark' },
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      harnessFactory: () => {
        const harness = fakeHarness();
        if (created.length === 0) {
          harness.run = vi.fn(() => new Promise((resolve) => {
            settleFirst = () => resolve({
              sessionId: 'session-a',
              finalResponse: 'a',
              events: [],
              notifications: [],
            });
          })) as unknown as typeof harness.run;
        }
        created.push(harness);
        return harness;
      },
    });
    const base = {
      runtimeKey: 'scope-a\0/tmp/shared',
      cwd: '/tmp/shared',
      model: undefined,
      images: undefined,
      stopGraceMs: undefined,
    };
    const runA = adapter.run({
      ...base,
      runId: 'concurrent-a',
      prompt: 'a',
      sessionId: 'session-shared',
    });
    const runB = adapter.run({
      ...base,
      runId: 'concurrent-b',
      prompt: 'b',
      sessionId: 'session-shared',
    });

    expect(created).toHaveLength(2);
    await runA.stop();
    expect(created[0]?.close).toHaveBeenCalledTimes(1);
    expect(created[1]?.close).not.toHaveBeenCalled();

    settleFirst?.();
    void runA.events;
    const runBEvents = [];
    for await (const event of runB.events) runBEvents.push(event);
    expect(runBEvents.at(-1)).toMatchObject({ type: 'done' });
    expect(runBEvents.at(-1)).not.toMatchObject({ sessionId: 'session-shared' });
    await adapter.dispose();
  });

  it('hot-switches the runtime route when the per-run model/provider changes', async () => {
    const created: Array<{ cwd: string; route: ModelRoute }> = [];
    const adapter = new SdkDshAdapter({
      launch: { command: 'node', args: ['bin.js', '--profile', 'dsh-lark'], profile: 'dsh-lark' },
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      harnessFactory: (cwd, route) => {
        created.push({ cwd, route });
        return fakeHarness(route);
      },
    });

    const runFirst = adapter.run({
      runId: 'r4',
      prompt: 'hi',
      cwd: '/tmp/a',
      sessionId: 'session-1',
      model: 'deepseek-v4-flash',
      provider: 'deepseek-official',
      images: undefined,
      stopGraceMs: undefined,
    });
    const firstEvents = [];
    for await (const event of runFirst.events) firstEvents.push(event);

    // Switching the model route for the same cwd must spawn a fresh harness
    // (the SDK JSON-RPC server binds provider/model at session creation) and
    // close the previous one instead of silently keeping the old route.
    const runSecond = adapter.run({
      runId: 'r5',
      prompt: 'hi',
      cwd: '/tmp/a',
      sessionId: 'session-1',
      model: 'doubao-seed-2-0-lite-260428',
      provider: 'kingapi',
      images: undefined,
      stopGraceMs: undefined,
    });
    const secondEvents = [];
    for await (const event of runSecond.events) secondEvents.push(event);

    expect(created).toEqual([
      { cwd: '/tmp/a', route: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } },
      { cwd: '/tmp/a', route: { provider: 'kingapi', model: 'doubao-seed-2-0-lite-260428' } },
    ]);
    expect(secondEvents.at(-1)).toMatchObject({ type: 'done', sessionId: 'session-1' });
    await adapter.dispose();
  });

  it('reuses the harness when the requested route matches', async () => {
    const created: Array<{ cwd: string; route: ModelRoute }> = [];
    const adapter = new SdkDshAdapter({
      launch: { command: 'node', args: ['bin.js', '--profile', 'dsh-lark'], profile: 'dsh-lark' },
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      harnessFactory: (cwd, route) => {
        created.push({ cwd, route });
        return fakeHarness(route);
      },
    });

    const run = (runId: string) =>
      adapter.run({
        runId,
        prompt: 'hi',
        cwd: '/tmp/a',
        sessionId: 'session-stable',
        model: 'deepseek-v4-flash',
        provider: 'deepseek-official',
        images: undefined,
        stopGraceMs: undefined,
      });
    for await (const _event of run('r6').events) {
      // consume
    }
    for await (const _event of run('r7').events) {
      // consume
    }
    expect(created.length).toBe(1);
    await adapter.dispose();
  });

  it('only resumes sessions owned by the current live runtime', async () => {
    const adapter = new SdkDshAdapter({
      launch: { command: 'node', args: ['bin.js', '--profile', 'dsh-lark'], profile: 'dsh-lark' },
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      harnessFactory: () => fakeHarness(),
    });
    const resumeQuery = {
      runtimeKey: 'chat-a\0/tmp/a',
      cwd: '/tmp/a',
      sessionId: 'session-live',
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
    };

    expect(adapter.canResume(resumeQuery)).toBe(false);
    const run = adapter.run({
      runId: 'live-session-run',
      runtimeKey: resumeQuery.runtimeKey,
      prompt: 'hi',
      cwd: resumeQuery.cwd,
      sessionId: resumeQuery.sessionId,
      provider: resumeQuery.provider,
      model: resumeQuery.model,
      images: undefined,
      stopGraceMs: undefined,
    });
    expect(adapter.canResume(resumeQuery)).toBe(false);
    for await (const _event of run.events) {
      // consume
    }
    expect(adapter.canResume(resumeQuery)).toBe(true);

    await run.stop();
    expect(adapter.canResume(resumeQuery)).toBe(false);
    await adapter.dispose();
  });

  it('retires (not kills) the old harness when the route switches mid-flight', async () => {
    const created: Array<{ cwd: string; route: ModelRoute; harness: DeepSeekHarness }> = [];
    let releaseFirst: (() => void) | undefined;
    const adapter = new SdkDshAdapter({
      launch: { command: 'node', args: ['bin.js', '--profile', 'dsh-lark'], profile: 'dsh-lark' },
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      harnessFactory: (cwd, route) => {
        const harness = fakeHarness(route);
        if (created.length === 0) {
          const originalRun = harness.run.bind(harness);
          harness.run = vi.fn((input, options) =>
            new Promise((resolve) => {
              releaseFirst = () => void resolve(originalRun(input, options));
            }),
          ) as unknown as typeof harness.run;
        }
        created.push({ cwd, route, harness });
        return harness;
      },
    });

    const first = adapter.run({
      runId: 'r8',
      prompt: 'hi',
      cwd: '/tmp/a',
      sessionId: 'session-1',
      model: 'deepseek-v4-flash',
      provider: 'deepseek-official',
      images: undefined,
      stopGraceMs: undefined,
    });
    // The route switch happens while run 1 is still in flight.
    const second = adapter.run({
      runId: 'r9',
      prompt: 'hi',
      cwd: '/tmp/a',
      sessionId: 'session-2',
      model: 'doubao-seed-2-0-lite-260428',
      provider: 'kingapi',
      images: undefined,
      stopGraceMs: undefined,
    });

    // The old harness must NOT be closed while its run is still active.
    expect(created[0]?.harness.close).not.toHaveBeenCalled();
    expect(created).toHaveLength(2);

    // Once run 1 settles, the retired harness is closed.
    releaseFirst?.();
    const firstEvents = [];
    for await (const event of first.events) firstEvents.push(event);
    expect(firstEvents.at(-1)).toMatchObject({ type: 'done', sessionId: 'session-1' });
    expect(created[0]?.harness.close).toHaveBeenCalledTimes(1);

    void second.events;
    await adapter.dispose();
  });

  it('retries the initialize handshake on the transient pi-ai registration race', async () => {
    let startFailures = 1;
    let initFailures = 1;
    const harness = fakeHarness({ provider: 'kingapi', model: 'doubao-seed-2-0-lite-260428' });
    const originalRun = harness.run.bind(harness);
    harness.start = vi.fn(async () => {
      if (startFailures > 0) {
        startFailures -= 1;
        throw new Error('no adapter registered for provider "kingapi"');
      }
      return undefined;
    }) as unknown as typeof harness.start;
    // After the failed handshake the real client swaps in a fresh client;
    // initialize on the SAME client is polled until llm-pi-ai registers.
    const client = {
      start: vi.fn(async () => undefined),
      initialize: vi.fn(async () => {
        if (initFailures > 0) {
          initFailures -= 1;
          throw new Error('no adapter registered for provider "kingapi"');
        }
        return { serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' } };
      }),
    };
    (harness as unknown as { client: unknown }).client = client;
    harness.run = vi.fn((input, options) => {
      return harness.start().then(() => originalRun(input, options));
    }) as unknown as typeof harness.run;

    const adapter = new SdkDshAdapter({
      launch: { command: 'node', args: ['bin.js', '--profile', 'dsh-lark'], profile: 'dsh-lark' },
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      harnessFactory: () => harness,
    });

    const run = adapter.run({
      runId: 'r10',
      prompt: 'hi',
      cwd: '/tmp/a',
      sessionId: undefined,
      model: 'doubao-seed-2-0-lite-260428',
      provider: 'kingapi',
      images: undefined,
      stopGraceMs: undefined,
    });
    const events = [];
    for await (const event of run.events) events.push(event);

    expect(events.at(-1)).toMatchObject({ type: 'done' });
    expect(events.some((event) => event.type === 'error')).toBe(false);
    await adapter.dispose();
  });
});
