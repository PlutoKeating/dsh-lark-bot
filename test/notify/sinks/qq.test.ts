import { afterEach, describe, expect, it, vi } from 'vitest';
import { QqSink, splitAppCredential } from '../../../src/notify/sinks/qq.js';
import type { SinkChannel } from '../../../src/notify/sinks/types.js';

afterEach(() => vi.restoreAllMocks());

const channel: SinkChannel = {
  id: 'qq-main',
  type: 'qq',
  label: 'QQ 群',
  destination: 'group_openid',
  secret: 'appId:clientSecret',
  enabled: true,
};
const message = { scope: 'chat-a', event: 'completed' as const, title: { zh: '✅ 任务已完成', en: '✅ Task completed' } };

describe('QqSink', () => {
  it('fetches an access token then POSTs the group message with Bearer auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'm1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const fetchToken = vi.fn().mockResolvedValue('access-token');
    const sink = new QqSink('https://api.sgroup.qq.com', fetchToken);
    await expect(sink.send(channel, message)).resolves.toBe(true);
    expect(fetchToken).toHaveBeenCalledWith('appId', 'clientSecret');
    const response = await fetchMock.mock.results[0]?.value;
    void response;
    const call = fetchMock.mock.calls[0]!;
    expect(call[0]).toBe('https://api.sgroup.qq.com/v2/groups/group_openid/messages');
    const init = call[1] as RequestInit;
    expect(init.headers).toMatchObject({ authorization: 'Bearer access-token' });
    expect(JSON.parse(init.body as string)).toMatchObject({ msg_type: 0 });
  });

  it('returns false on a non-ok send response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 1, message: 'forbidden' }), { status: 403 })));
    await expect(new QqSink('https://api.sgroup.qq.com', () => Promise.resolve('t')).send(channel, message)).resolves.toBe(false);
  });

  it('returns false when the credential is malformed', async () => {
    await expect(new QqSink('https://api.sgroup.qq.com', () => Promise.resolve('t')).send({ ...channel, secret: 'appIdOnly' }, message)).resolves.toBe(false);
  });
});

describe('splitAppCredential', () => {
  it('splits app_id and client_secret on the first colon', () => {
    expect(splitAppCredential('appId:clientSecret')).toEqual(['appId', 'clientSecret']);
    expect(splitAppCredential('appId')).toEqual(['appId', '']);
  });
});
