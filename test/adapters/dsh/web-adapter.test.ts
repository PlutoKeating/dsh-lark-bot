import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebDshAdapter } from '../../../src/adapters/dsh/web-adapter.js';

class FakeWebSocket extends EventTarget {
  static latest: FakeWebSocket | undefined;
  constructor(_url: string | URL) {
    super();
    FakeWebSocket.latest = this;
    queueMicrotask(() => this.dispatchEvent(new Event('open')));
  }
  close(): void { this.dispatchEvent(new Event('close')); }
  emit(payload: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(payload) }));
  }
}

afterEach(() => vi.unstubAllGlobals());

describe('WebDshAdapter prompt provenance', () => {
  it('durably records the request rpcId before sending a Feishu-origin prompt', async () => {
    const order: string[] = [];
    let promptRpcId = '';
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string; rpcId: string };
      expect(body.method).toBe('session.prompt');
      promptRpcId = body.rpcId;
      order.push('fetch');
      queueMicrotask(() => FakeWebSocket.latest?.emit({ payload: {
        type: 'session/event', sessionId: 's1',
        event: { type: 'turn/end', seq: 2, time: 1, data: { turn: 1, reason: { kind: 'completed' } } },
      } }));
      return new Response(JSON.stringify({ result: { ok: true, value: { accepted: true } } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }));
    const adapter = new WebDshAdapter({ provider: 'p', model: 'm' });
    const observer = vi.fn(async (input: { rpcId: string }) => {
      expect(input.rpcId).toMatch(/^[0-9a-f-]{36}$/u);
      order.push('observer');
    });
    adapter.setPromptObserver(observer);
    const run = adapter.run({
      runId: 'run-1', prompt: 'hello', cwd: '/repo', sessionId: 's1', model: 'm',
      images: undefined, stopGraceMs: 1_000,
      origin: { source: 'feishu', messageId: 'message-1', scope: 'chat-a', workspaceCwd: '/repo' },
    });
    for await (const _event of run.events) { /* drain */ }
    expect(order).toEqual(['observer', 'fetch']);
    expect(observer).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 's1', rpcId: promptRpcId,
      origin: expect.objectContaining({ messageId: 'message-1', scope: 'chat-a' }),
    }));
    await adapter.dispose();
  });
});
