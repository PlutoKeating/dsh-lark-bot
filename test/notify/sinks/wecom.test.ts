import { afterEach, describe, expect, it, vi } from 'vitest';
import { WeComSink } from '../../../src/notify/sinks/wecom.js';
import type { SinkChannel } from '../../../src/notify/sinks/types.js';

afterEach(() => vi.restoreAllMocks());

const channel: SinkChannel = { id: 'wecom-main', type: 'wecom', label: '群机器人', destination: 'webhook-key', secret: 'webhook-key', enabled: true };
const message = { scope: 'chat-a', event: 'failed' as const, title: { zh: '⚠️ 任务执行失败', en: '⚠️ Task failed' } };

describe('WeComSink', () => {
  it('POSTs to the group-robot webhook with the key and text', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ errcode: 0, errmsg: 'ok' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const sink = new WeComSink('https://qyapi.weixin.qq.com');
    await expect(sink.send(channel, message)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=webhook-key', expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toMatchObject({ msgtype: 'text' });
    expect(body.text.content).toContain('任务执行失败');
  });

  it('returns false on a non-zero errcode', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ errcode: 403, errmsg: 'invalid key' }), { status: 200 })));
    await expect(new WeComSink('https://qyapi.weixin.qq.com').send(channel, message)).resolves.toBe(false);
  });

  it('returns false on a transport error without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    await expect(new WeComSink('https://qyapi.weixin.qq.com').send(channel, message)).resolves.toBe(false);
  });
});
