import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NotifyMessage } from '../../src/notify/server.js';
import { NotifyServer } from '../../src/notify/server.js';
import { ScopeDirectory } from '../../src/bridge/scope-directory.js';
import { apply as applyNotifyTool } from '../../src/notify/tool.js';

const servers: NotifyServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

async function startServer(deps: {
  directory: ScopeDirectory;
  send?: ReturnType<typeof vi.fn>;
}) {
  const send = deps.send ?? vi.fn().mockResolvedValue(undefined);
  const server = new NotifyServer({
    token: 'test-token',
    resolve: (message: NotifyMessage) => {
      if (message.scope) return deps.directory.resolve(message.scope);
      if (message.chatId) return deps.directory.resolveChat(message.chatId);
      return undefined;
    },
    send,
  });
  servers.push(server);
  await server.start();
  return { server, send };
}

describe('NotifyServer', () => {
  it('serves authenticated file uploads and validates required fields', async () => {
    const file = vi.fn().mockResolvedValue({ ok: true, fileName: 'report.md', size: 6 });
    const server = new NotifyServer({ token: 'test-token', resolve: () => undefined, send: vi.fn(), file });
    servers.push(server);
    await server.start();
    const response = await fetch(server.fileUrl!, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'test-token', sessionId: 's1', path: 'report.md' }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, fileName: 'report.md', size: 6 });
    expect(file).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1', path: 'report.md' }));
    const bad = await fetch(server.fileUrl!, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'wrong', sessionId: 's1', path: 'report.md' }),
    });
    expect(bad.status).toBe(401);
  });

  it('sends messages with mentions to a resolved scope', async () => {
    const directory = new ScopeDirectory(':memory:');
    directory.register('chat-a', 'oc_group', undefined);
    const { server, send } = await startServer({ directory });

    const response = await fetch(server.url!, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: 'test-token',
        scope: 'chat-a',
        text: 'task done',
        mentions: [{ userId: 'ou_user1', name: 'Alice' }],
      }),
    });
    expect(response.status).toBe(200);
    expect(send).toHaveBeenCalledWith(
      { chatId: 'oc_group', threadId: undefined },
      {
        text: 'task done',
        mentions: [{ userId: 'ou_user1', name: 'Alice' }],
      },
    );
  });

  it('rejects bad tokens and unknown scopes', async () => {
    const directory = new ScopeDirectory(':memory:');
    const { server, send } = await startServer({ directory });

    const badToken = await fetch(server.url!, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'wrong', chatId: 'oc_group', text: 'x' }),
    });
    expect(badToken.status).toBe(401);

    const unknown = await fetch(server.url!, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'test-token', scope: 'nope', text: 'x' }),
    });
    expect(unknown.status).toBe(404);
    expect(send).not.toHaveBeenCalled();
  });

  it('end-to-end: the lark_notify tool posts through the real server', async () => {
    const directory = new ScopeDirectory(':memory:');
    directory.register('chat-a', 'oc_group', undefined);
    const { server, send } = await startServer({ directory });

    let registered: unknown;
    applyNotifyTool(
      {
        logger: { warn: vi.fn() },
        tools: { register: vi.fn((definition) => { registered = definition; }) },
      } as never,
      {
        ...(server.url ? { endpoint: server.url } : {}),
        token: 'test-token',
      },
    );

    const tool = registered as { execute(args: unknown, exec: unknown): Promise<unknown> };
    const result = await tool.execute(
      { text: 'report ready', scope: 'chat-a', mention_user_ids: ['ou_user1'] },
      {} as never,
    );
    expect(result).toEqual({ ok: true, chatId: 'oc_group' });
    expect(send).toHaveBeenCalledWith(
      { chatId: 'oc_group', threadId: undefined },
      {
        text: 'report ready',
        mentions: [{ userId: 'ou_user1' }],
      },
    );
  });

  it('serves the ask endpoint when an ask handler is wired', async () => {
    const ask = vi.fn().mockResolvedValue({ ok: true, answer: 'use A' });
    const server = new NotifyServer({
      token: 'test-token',
      resolve: () => undefined,
      send: vi.fn(),
      ask,
    });
    servers.push(server);
    await server.start();
    expect(server.askUrl).toBeTruthy();

    const response = await fetch(server.askUrl!, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: 'test-token',
        sessionId: 'session-1',
        question: 'Which plan?',
        kind: 'single',
        options: ['A', 'B'],
      }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, answer: 'use A' });
    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1', question: 'Which plan?' }),
      expect.any(AbortSignal),
    );
  });

  it('rejects ask requests with an invalid token or missing fields', async () => {
    const ask = vi.fn();
    const server = new NotifyServer({
      token: 'test-token',
      resolve: () => undefined,
      send: vi.fn(),
      ask,
    });
    servers.push(server);
    await server.start();

    const badToken = await fetch(server.askUrl!, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'wrong', sessionId: 's', question: 'Q' }),
    });
    expect(badToken.status).toBe(401);

    const missing = await fetch(server.askUrl!, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'test-token', sessionId: 's' }),
    });
    expect(missing.status).toBe(400);
    expect(ask).not.toHaveBeenCalled();
  });

  it('returns 404 for /ask when no ask handler is wired', async () => {
    const directory = new ScopeDirectory(':memory:');
    const { server } = await startServer({ directory });
    const response = await fetch(`${server.url!.replace('/notify', '')}/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'test-token', sessionId: 's', question: 'Q' }),
    });
    expect(response.status).toBe(404);
  });

  it('serves authenticated plan decisions', async () => {
    const plan = vi.fn().mockResolvedValue({
      ok: true,
      decision: 'revise',
      feedback: 'keep it read-only',
    });
    const server = new NotifyServer({
      token: 'test-token',
      resolve: () => undefined,
      send: vi.fn(),
      plan,
    });
    servers.push(server);
    await server.start();
    const response = await fetch(server.planUrl!, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: 'test-token',
        sessionId: 'session-1',
        plan: '1. inspect\n2. change',
      }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      decision: 'revise',
      feedback: 'keep it read-only',
    });
  });

  it('sends plan response headers before the human decision is available', async () => {
    let resolvePlan: ((value: { ok: true; decision: 'approved' }) => void) | undefined;
    const plan = vi.fn(() => new Promise<{ ok: true; decision: 'approved' }>((resolve) => {
      resolvePlan = resolve;
    }));
    const server = new NotifyServer({
      token: 'test-token',
      resolve: () => undefined,
      send: vi.fn(),
      plan,
    });
    servers.push(server);
    await server.start();

    const request = fetch(server.planUrl!, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: 'test-token',
        sessionId: 'session-1',
        plan: 'Wait for approval',
      }),
    });
    await vi.waitFor(() => expect(plan).toHaveBeenCalledOnce());
    const first = await Promise.race([
      request.then(() => 'headers' as const),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 500)),
    ]);

    resolvePlan?.({ ok: true, decision: 'approved' });
    const response = await request;
    expect(first).toBe('headers');
    await expect(response.json()).resolves.toEqual({ ok: true, decision: 'approved' });
  });

  it('streams JSON-compatible heartbeats while a human callback is pending', async () => {
    let resolveAsk: ((value: { ok: true; answer: string }) => void) | undefined;
    const ask = vi.fn(() => new Promise<{ ok: true; answer: string }>((resolve) => {
      resolveAsk = resolve;
    }));
    const server = new NotifyServer({
      token: 'test-token',
      resolve: () => undefined,
      send: vi.fn(),
      ask,
      longPollHeartbeatMs: 10,
    });
    servers.push(server);
    await server.start();

    const response = await fetch(server.askUrl!, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: 'test-token',
        sessionId: 'session-1',
        question: 'Still waiting?',
      }),
    });
    const reader = response.body!.getReader();
    const first = await Promise.race([
      reader.read(),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('heartbeat not received')), 500);
      }),
    ]);
    expect(new TextDecoder().decode(first.value)).toBe('\n');

    resolveAsk?.({ ok: true, answer: 'yes' });
    let remainder = '';
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      remainder += new TextDecoder().decode(chunk.value);
    }
    expect(JSON.parse(remainder) as unknown).toEqual({ ok: true, answer: 'yes' });
  });

  it('returns post-flush human callback failures in the JSON body', async () => {
    const plan = vi.fn().mockResolvedValue({ ok: false, error: 'plan cancelled' });
    const server = new NotifyServer({
      token: 'test-token',
      resolve: () => undefined,
      send: vi.fn(),
      plan,
    });
    servers.push(server);
    await server.start();

    const response = await fetch(server.planUrl!, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: 'test-token',
        sessionId: 'session-1',
        plan: 'Cancelled plan',
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'plan cancelled' });
  });

  it('propagates a disconnected plan request as an abort signal', async () => {
    let observedAbort = false;
    const plan = vi.fn(async (_payload, signal?: AbortSignal) => {
      await new Promise<void>((resolve) => {
        if (signal?.aborted) {
          observedAbort = true;
          resolve();
          return;
        }
        signal?.addEventListener('abort', () => {
          observedAbort = true;
          resolve();
        }, { once: true });
      });
      return { ok: false, error: 'cancelled' };
    });
    const server = new NotifyServer({
      token: 'test-token',
      resolve: () => undefined,
      send: vi.fn(),
      plan,
    });
    servers.push(server);
    await server.start();
    const controller = new AbortController();
    const request = fetch(server.planUrl!, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'test-token', sessionId: 'session-1', plan: 'Plan' }),
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(plan).toHaveBeenCalledOnce());
    const response = await request;
    const body = response.json();
    controller.abort();

    await expect(body).rejects.toThrow();
    await vi.waitFor(() => expect(observedAbort).toBe(true));
  });

  it('serves authenticated one-shot approval outcomes', async () => {
    const approval = vi.fn().mockResolvedValue({ ok: true, outcome: 'rejected' });
    const server = new NotifyServer({
      token: 'test-token', resolve: () => undefined, send: vi.fn(), approval,
    });
    servers.push(server);
    await server.start();
    const response = await fetch(server.approvalUrl!, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: 'test-token', sessionId: 'session-1', toolName: 'bash',
        callId: 'call-1', reason: 'run tests',
      }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, outcome: 'rejected' });
    expect(approval).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1', toolName: 'bash' }),
      expect.any(AbortSignal),
    );
  });

  it('rejects invalid approval callbacks before invoking the handler', async () => {
    const approval = vi.fn();
    const server = new NotifyServer({
      token: 'test-token', resolve: () => undefined, send: vi.fn(), approval,
    });
    servers.push(server);
    await server.start();
    const response = await fetch(server.approvalUrl!, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'wrong', sessionId: 's', toolName: 'bash' }),
    });
    expect(response.status).toBe(401);
    expect(approval).not.toHaveBeenCalled();
  });
});
