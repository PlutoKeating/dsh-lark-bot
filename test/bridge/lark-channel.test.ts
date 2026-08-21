import { describe, expect, it, vi } from 'vitest';
import { adaptLarkChannel } from '../../src/bridge/lark-channel.js';
import type { LarkChannel } from '@larksuite/channel';

describe('adaptLarkChannel', () => {
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

  it('contains a timed-out streaming card patch without stopping the producer', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: 'stream-card' });
    const updateCard = vi.fn().mockRejectedValue(new Error('timeout of 30000ms exceeded'));
    const stream = vi.fn(async (
      _chatId: string,
      input: { card: { producer(controller: { update(card: object): Promise<void> }): Promise<void> } },
    ) => {
      await input.card.producer({ update: updateCard });
    });
    const channel = { send, updateCard, stream } as unknown as LarkChannel;
    const bridge = adaptLarkChannel(channel);

    await expect(bridge.streamCard(
      'oc_chat',
      { state: 'initial' },
      async (controller) => {
        await controller.update({ state: 'streaming' });
        await new Promise((resolve) => setTimeout(resolve, 150));
        await controller.update({ state: 'final' });
      },
    )).resolves.toBeUndefined();

    expect(stream).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('oc_chat', { card: { state: 'initial' } }, {});
    expect(updateCard).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[1]).toMatchObject({
      markdown: expect.stringContaining('任务仍在继续'),
    });
  });

  it('recovers a streaming card after one transient patch failure', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: 'stream-card' });
    const updateCard = vi.fn()
      .mockRejectedValueOnce(new Error('temporary timeout'))
      .mockResolvedValue(undefined);
    const channel = { send, updateCard } as unknown as LarkChannel;
    const bridge = adaptLarkChannel(channel);

    await bridge.streamCard('oc_chat', { state: 'initial' }, async (controller) => {
      await controller.update({ state: 'final' });
    });

    expect(updateCard).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledOnce();
  });
});
