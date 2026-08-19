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
});
