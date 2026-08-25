import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isPathWithin, truncateUtf8Safe } from '../config/security.js';
import type {
  LarkChannel,
  NormalizedMessage,
} from '@larksuite/channel';
import { detectImageType } from './image-file.js';
import { downscaleImageIfNeeded } from './image-scale.js';

export interface PreparedAttachments {
  imagePaths: string[];
  textFileNotes: string[];
}

export interface PrepareAttachmentsOptions {
  /** Long-edge bound (px) for inbound images; oversized images are downscaled proportionally. */
  maxImageDimension?: number;
}

const MAX_TEXT_FILE_BYTES = 256_000;

function assertSafeMediaName(mediaDir: string, destination: string): void {
  if (!isPathWithin(mediaDir, destination)) {
    throw new Error(`unsafe attachment destination rejected: ${destination}`);
  }
}

export async function prepareAttachments(
  channel: LarkChannel | undefined,
  message: NormalizedMessage,
  mediaDir: string,
  options: PrepareAttachmentsOptions = {},
): Promise<PreparedAttachments> {
  const { maxImageDimension = 0 } = options;
  await mkdir(mediaDir, { recursive: true });
  const result: PreparedAttachments = { imagePaths: [], textFileNotes: [] };

  for (const resource of message.resources) {
    if (!channel || resource.type !== 'image' && resource.type !== 'file') continue;
    const destination = join(mediaDir, `${message.messageId}-${resource.fileKey}`);
    assertSafeMediaName(mediaDir, destination);
    const downloadPath = resource.type === 'image' ? `${destination}.download` : destination;
    assertSafeMediaName(mediaDir, downloadPath);
    await channel.downloadResourceToFile(
      message.messageId,
      resource.fileKey,
      resource.type,
      downloadPath,
    );

    if (resource.type === 'image') {
      try {
        const detected = await detectImageType(downloadPath);
        const imagePath = `${destination}${detected.extension}`;
        assertSafeMediaName(mediaDir, imagePath);
        await rename(downloadPath, imagePath);
        const finalPath = await downscaleImageIfNeeded(imagePath, maxImageDimension);
        result.imagePaths.push(finalPath);
      } catch (error) {
        await rm(downloadPath, { force: true });
        throw error;
      }
      continue;
    }

    const info = await stat(destination);
    if (info.size > MAX_TEXT_FILE_BYTES) {
      result.textFileNotes.push(`[attachment: ${resource.fileName ?? resource.fileKey}] ${destination}`);
      continue;
    }

    const content = await readFile(destination, 'utf8');
    const safeContent = truncateUtf8Safe(content, MAX_TEXT_FILE_BYTES);
    result.textFileNotes.push(
      `[attachment: ${resource.fileName ?? resource.fileKey}]\n${safeContent}`,
    );
  }

  return result;
}
