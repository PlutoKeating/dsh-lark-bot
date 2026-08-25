import { afterEach, describe, expect, it, vi } from 'vitest';
import { WeChatIlinkSink, splitDestination } from '../../../src/notify/sinks/wechat.js';
import type { SinkChannel } from '../../../src/notify/sinks/types.js';

afterEach(() => vi.restoreAllMocks());

const channel: SinkChannel = {
  id: 'wx-main',
  type: 'wechat',
  label: '个人微信',
  destination: 'user-123|ctx-abc',
  secret: 'bot-token',
  enabled: true,
};
const message = { scope: 'chat-a', event: 'completed' as const, title: { zh: '✅ 任务已完成', en: '✅ Task completed' } };

describe('WeChatIlinkSink', () => {
  it('POSTs the iLink payload with bearer token, context_token and target', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ret: 0 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const sink = new WeChatIlinkSink('https://ilinkai.weixin.qq.com', () => '481516');
    await expect(sink.send(channel, message)).resolves.toBe(true);
    const call = fetchMock.mock.calls[0]!;
    expect(call[0]).toBe('https://ilinkai.weixin.qq.com/ilink/bot/sendmessage');
    const init = call[1] as RequestInit;
    expect(init.headers).toMatchObject({
      authorization: 'Bearer bot-token',
      AuthorizationType: 'ilink_bot_token',
      'X-WECHAT-UIN': '481516',
      'iLink-App-Id': 'bot',
    });
    const body = JSON.parse(init.body as string);
    expect(body.msg.to_user_id).toBe('user-123');
    expect(body.msg.context_token).toBe('ctx-abc');
    expect(body.msg.item_list[0].text_item.text).toContain('任务已完成');
  });

  it('returns false when the destination lacks a context token', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const sink = new WeChatIlinkSink('https://ilinkai.weixin.qq.com');
    await expect(sink.send({ ...channel, destination: 'user-123' }, message)).resolves.toBe(false);
  });

  it('returns false on a transport error without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(new WeChatIlinkSink('https://ilinkai.weixin.qq.com').send(channel, message)).resolves.toBe(false);
  });
});

describe('splitDestination', () => {
  it('splits to_user_id and context_token on the first pipe', () => {
    expect(splitDestination('user|ctx')).toEqual(['user', 'ctx']);
    expect(splitDestination('user')).toEqual(['user', '']);
  });
});
