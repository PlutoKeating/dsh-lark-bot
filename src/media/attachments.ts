import { mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  LarkChannel,
  NormalizedMessage,
} from '@larksuite/channel';

export interface PreparedAttachments {
  imagePaths: string[];
  textFileNotes: string[];
}

const MAX_TEXT_FILE_BYTES = 256_000;

export async function prepareAttachments(
  channel: LarkChannel | undefined,
  message: NormalizedMessage,
  mediaDir: string,
): Promise<PreparedAttachments> {
  await mkdir(mediaDir, { recursive: true });
  const result: PreparedAttachments = { imagePaths: [], textFileNotes: [] };

  for (const resource of message.resources) {
    if (!channel || resource.type !== 'image' && resource.type !== 'file') continue;
    const destination = join(mediaDir, `${message.messageId}-${resource.fileKey}`);
    await channel.downloadResourceToFile(
      message.messageId,
      resource.fileKey,
      resource.type,
      destination,
    );

    if (resource.type === 'image') {
      result.imagePaths.push(destination);
      continue;
    }

    const info = await stat(destination);
    if (info.size > MAX_TEXT_FILE_BYTES) {
      result.textFileNotes.push(`[attachment: ${resource.fileName ?? resource.fileKey}] ${destination}`);
      continue;
    }

    const content = await readFile(destination, 'utf8');
    result.textFileNotes.push(
      `[attachment: ${resource.fileName ?? resource.fileKey}]\n${content}`,
    );
  }

  return result;
}
