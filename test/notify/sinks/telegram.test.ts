import { afterEach, describe, expect, it, vi } from 'vitest';
import { TelegramSink } from '../../../src/notify/sinks/telegram.js';
import type { SinkChannel } from '../../../src/notify/sinks/types.js';

afterEach(() => vi.restoreAllMocks());

const channel: SinkChannel = { id: 'tg-main', type: 'telegram', label: 'Ops', destination: '@ops', secret: '123:abc', enabled: true };
const message = { scope: 'chat-a', event: 'completed' as const, title: { zh: '✅ 任务已完成', en: '✅ Task completed' } };

describe('TelegramSink', () => {
  it('POSTs to the Bot API with the token and chat_id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const sink = new TelegramSink('https://api.telegram.org');
    await expect(sink.send(channel, message)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('https://api.telegram.org/bot123%3Aabc/sendMessage', expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toMatchObject({ chat_id: '@ops', parse_mode: 'HTML' });
    expect(body.text).toContain('任务已完成');
    expect(body.text).not.toContain('`');
  });

  it('returns false on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, description: 'unauthorized' }), { status: 401 })));
    await expect(new TelegramSink('https://api.telegram.org').send(channel, message)).resolves.toBe(false);
  });

  it('returns false on a transport error without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(new TelegramSink('https://api.telegram.org').send(channel, message)).resolves.toBe(false);
  });
});
