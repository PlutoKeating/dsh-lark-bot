import { describe, expect, it, vi } from 'vitest';
import { WebSessionProjectionSource, decodeMuxEvent } from '../../src/session/projection-protocol.js';

describe('WebSessionProjectionSource', () => {
  it('uses the pinned session RPC shapes and preserves prompt rpcId provenance', async () => {
    const rpc = vi.fn(async (method: string, payload: unknown, rpcId?: string) => {
      if (method === 'session.list') return { result: { ok: true, value: { items: [{
        sessionId: 's1', updatedAt: 12, running: false, blank: false, cwd: '/repo',
        projections: { asOfSeq: 2, values: { title: 'Release work' } },
      }, {
        sessionId: 'sub', updatedAt: 11, running: false, blank: false, cwd: '/repo', origin: 'subagent',
      }] } } };
      if (method === 'session.history') return { result: { ok: true, value: {
        events: [{ event: { type: 'user/message', seq: 3, time: 10, data: { role: 'user' } } }],
        hasMore: false,
      } } };
      expect(payload).toMatchObject({ sessionId: 's1', mode: 'queue' });
      expect(rpcId).toBe('rpc-feishu');
      return { result: { ok: true, value: { accepted: true } } };
    });
    const source = new WebSessionProjectionSource({
      rpc: async <T>(method: string, payload: unknown, rpcId?: string): Promise<T> =>
        rpc(method, payload, rpcId) as Promise<T>,
      openMux: vi.fn(),
    });
    expect(await source.listSessions()).toEqual([
      expect.objectContaining({ sessionId: 's1', title: 'Release work' }),
      expect.objectContaining({ sessionId: 'sub', origin: 'subagent' }),
    ]);
    expect((await source.history('s1', { beforeSeq: 4, maxMessages: 20 })).events[0]?.seq).toBe(3);
    await expect(source.prompt('s1', 'hello', 'rpc-feishu')).resolves.toEqual({ rpcId: 'rpc-feishu' });
  });

  it('decodes only valid session/event mux frames', () => {
    expect(decodeMuxEvent(JSON.stringify({ payload: {
      type: 'session/event', sessionId: 's1',
      event: { type: 'turn/end', seq: 4, time: 20, data: {} },
    } }))).toEqual({ sessionId: 's1', event: expect.objectContaining({ type: 'turn/end', seq: 4 }) });
    expect(decodeMuxEvent('{bad')).toBeUndefined();
    expect(decodeMuxEvent(JSON.stringify({ payload: { type: 'other' } }))).toBeUndefined();
  });
});
