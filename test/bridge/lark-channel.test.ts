import { describe, expect, it, vi } from 'vitest';
import { adaptLarkChannel } from '../../src/bridge/lark-channel.js';
import type { LarkChannel } from '@larksuite/channel';

describe('adaptLarkChannel file delivery', () => {
  it('uploads an in-memory file without granting local filesystem access', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: 'file-message' });
    const channel = { send } as unknown as LarkChannel;
    const bridge = adaptLarkChannel(channel);
    const content = Buffer.from('diagnostic');

    await bridge.sendFile?.('chat-a', 'diagnostic.md', content, {
      replyTo: 'msg-a',
      threadId: 'thread-a',
    });

    expect(send).toHaveBeenCalledWith(
      'chat-a',
      { file: { source: content, fileName: 'diagnostic.md' } },
      { replyTo: 'msg-a', replyInThread: true },
    );
  });

  it('uses a stable Feishu uuid for crash-safe idempotent card creation', async () => {
    const create = vi.fn().mockResolvedValue({ data: { message_id: 'card-message' } });
    const reply = vi.fn().mockResolvedValue({ data: { message_id: 'thread-card-message' } });
    const send = vi.fn();
    const channel = {
      send,
      rawClient: { im: { v1: { message: { create, reply } } } },
    } as unknown as LarkChannel;
    const bridge = adaptLarkChannel(channel);
    const card = { schema: '2.0', body: { elements: [] } };

    await bridge.sendCard?.('oc_chat', card, { idempotencyKey: 'projection:s1:seq:7' });
    await bridge.sendCard?.('oc_chat', card, { idempotencyKey: 'projection:s1:seq:7' });
    await bridge.sendCard?.('oc_chat', card, {
      idempotencyKey: 'projection:s1:seq:8', threadId: 'om_thread_root',
    });

    expect(send).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]?.[0]).toEqual(create.mock.calls[1]?.[0]);
    expect(create).toHaveBeenCalledWith({
      params: { receive_id_type: 'chat_id' },
      data: expect.objectContaining({
        receive_id: 'oc_chat', msg_type: 'interactive', content: JSON.stringify(card),
        uuid: expect.stringMatching(/^[a-f0-9]{50}$/u),
      }),
    });
    expect(reply).toHaveBeenCalledWith({
      path: { message_id: 'om_thread_root' },
      data: expect.objectContaining({
        msg_type: 'interactive', reply_in_thread: true,
        uuid: expect.stringMatching(/^[a-f0-9]{50}$/u),
      }),
    });

    create.mockResolvedValueOnce({ code: 999, msg: 'denied' });
    await expect(bridge.sendCard?.('oc_chat', card, { idempotencyKey: 'projection:error' }))
      .rejects.toThrow('denied');
    create.mockResolvedValueOnce({ code: 0, data: {} });
    await expect(bridge.sendCard?.('oc_chat', card, { idempotencyKey: 'projection:no-id' }))
      .rejects.toThrow('no message_id');
  });
});
