import { describe, expect, it, vi } from 'vitest';
import { apply } from '../../src/notify/secret-tool.js';

describe('lark_request_secret tool', () => {
  it('sends only target metadata and returns no value', async () => {
    let tool: any;
    apply({ tools: { register: (value: unknown) => { tool = value; return () => {}; } } } as any, { endpoint: 'http://local/secret', token: 'token' });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true, target: 'dsh-credential', reference: 'KEY', configured: true }), { status: 200 }));
    const result = await tool.execute({ target: 'dsh-credential', reference: 'KEY', purpose: 'provider auth' }, { agent: { session: { id: 'session-1' } } });
    const sent = String(fetchMock.mock.calls[0]?.[1]?.body);
    expect(sent).not.toContain('sentinel-secret');
    expect(result).toEqual({ ok: true, target: 'dsh-credential', reference: 'KEY', configured: true });
    expect(JSON.stringify(tool.output.render({}, result))).not.toContain('sentinel-secret');
    fetchMock.mockRestore();
  });
});
