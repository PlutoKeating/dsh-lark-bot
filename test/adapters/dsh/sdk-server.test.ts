import type { Context } from '@deepseek-ai/cordis';
import type { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol';
import { describe, expect, it, vi } from 'vitest';
import { LarkSdkJsonRpcServer } from '../../../src/adapters/dsh/sdk-server.js';

describe('LarkSdkJsonRpcServer', () => {
  it('admits uploaded bytes through the runtime attachment store', async () => {
    const saveImages = vi.fn().mockResolvedValue([{
      attachmentId: 'stored-image',
      mediaType: 'image/png',
      bytes: 8,
      width: 1,
      height: 1,
      name: 'incoming.png',
    }]);
    const ctx = {
      on: vi.fn().mockReturnValue(() => undefined),
      attachments: { saveImages },
    } as unknown as Context;
    const transport = { notify: vi.fn() } as unknown as JsonRpcLineTransport;
    const server = new LarkSdkJsonRpcServer(ctx, transport, {});

    await expect(server.handleRequest('attachment/upload', {
      images: [{
        mediaType: 'image/png',
        data: Buffer.from('89504e470d0a1a0a', 'hex').toString('base64'),
        name: 'incoming.png',
      }],
    })).resolves.toEqual({
      attachments: [expect.objectContaining({ attachmentId: 'stored-image' })],
    });
    expect(saveImages).toHaveBeenCalledOnce();
    expect(saveImages.mock.calls[0]?.[0]?.[0]).toMatchObject({
      mediaType: 'image/png',
      name: 'incoming.png',
    });
    expect(Buffer.from(saveImages.mock.calls[0]?.[0]?.[0]?.data)).toEqual(
      Buffer.from('89504e470d0a1a0a', 'hex'),
    );
  });

  it('rejects malformed upload requests before attachment storage', async () => {
    const saveImages = vi.fn();
    const ctx = {
      on: vi.fn().mockReturnValue(() => undefined),
      attachments: { saveImages },
    } as unknown as Context;
    const server = new LarkSdkJsonRpcServer(
      ctx,
      { notify: vi.fn() } as unknown as JsonRpcLineTransport,
      {},
    );

    await expect(server.handleRequest('attachment/upload', { images: [] }))
      .rejects.toThrow(/non-empty array/);
    expect(saveImages).not.toHaveBeenCalled();
  });
});
