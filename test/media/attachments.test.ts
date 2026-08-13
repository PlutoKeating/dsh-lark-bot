import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LarkChannel, NormalizedMessage } from '@larksuite/channel';
import { describe, expect, it, vi } from 'vitest';
import { prepareAttachments } from '../../src/media/attachments.js';

function message(resources: NormalizedMessage['resources']): NormalizedMessage {
  return {
    messageId: 'msg-1',
    chatId: 'chat-1',
    chatType: 'p2p',
    senderId: 'user-1',
    content: 'please review this',
    rawContentType: 'text',
    resources,
    mentions: [],
    mentionAll: false,
    mentionedBot: false,
    createTime: 1,
  };
}

function fakeChannel(files: Record<string, string>): LarkChannel {
  return {
    downloadResourceToFile: vi.fn().mockImplementation(
      async (_messageId: string, fileKey: string, _type: string, destPath: string) => {
        await writeFile(destPath, files[fileKey] ?? '');
        return { filePath: destPath };
      },
    ),
  } as unknown as LarkChannel;
}

describe('prepareAttachments', () => {
  it('downloads images and embeds text file content into prompt notes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-media-'));
    try {
      const result = await prepareAttachments(
        fakeChannel({
          'img-key': 'fake-image-bytes',
          'txt-key': 'hello from file',
        }),
        message([
          { type: 'image', fileKey: 'img-key', fileName: 'diagram.png' },
          { type: 'file', fileKey: 'txt-key', fileName: 'notes.txt' },
        ]),
        join(root, 'media'),
      );

      expect(result.imagePaths).toHaveLength(1);
      expect(result.textFileNotes[0]).toContain('notes.txt');
      expect(result.textFileNotes[0]).toContain('hello from file');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
