import { afterEach, describe, expect, it, vi } from 'vitest';
import { apply as applyFileTool } from '../../src/notify/file-tool.js';
import type { RawToolDefinition } from '../../src/notify/raw-tool.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

describe('lark_send_file tool plugin', () => {
  it('posts the active session and runtime cwd to the authenticated callback', async () => {
    const register = vi.fn();
    applyFileTool({ tools: { register } } as never, { endpoint: 'http://127.0.0.1/file', token: 'secret' });
    const tool = register.mock.calls[0]?.[0] as RawToolDefinition;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, fileName: 'report.md', size: 6 }) });
    globalThis.fetch = fetchMock as never;
    await expect(tool.execute({ path: 'report.md' }, { agent: { session: { id: 's1' }, cwd: '/work' } } as never)).resolves.toEqual({ ok: true, fileName: 'report.md', size: 6 });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1/file', expect.objectContaining({ body: JSON.stringify({ token: 'secret', sessionId: 's1', path: 'report.md', runtimeCwd: '/work' }) }));
  });

  it('requires an active session', async () => {
    const register = vi.fn();
    applyFileTool({ tools: { register } } as never, { endpoint: 'http://127.0.0.1/file', token: 'secret' });
    const tool = register.mock.calls[0]?.[0] as RawToolDefinition;
    await expect(tool.execute({ path: 'report.md' }, {})).rejects.toThrow('active session');
  });
});
