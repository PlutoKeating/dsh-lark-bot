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
  it('runs a prompt through a per-cwd harness and reuses sessions', async () => {
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
        sessionId: undefined,
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
});
