import { open } from 'node:fs/promises';

export type SupportedImageMediaType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp'
  | 'image/gif';

export interface DetectedImageType {
  mediaType: SupportedImageMediaType;
  extension: '.png' | '.jpg' | '.webp' | '.gif';
}

export async function detectImageType(path: string): Promise<DetectedImageType> {
  const handle = await open(path, 'r');
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const bytes = header.subarray(0, bytesRead);
    if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
      return { mediaType: 'image/png', extension: '.png' };
    }
    if (bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) {
      return { mediaType: 'image/jpeg', extension: '.jpg' };
    }
    const signature = bytes.subarray(0, 6).toString('ascii');
    if (signature === 'GIF87a' || signature === 'GIF89a') {
      return { mediaType: 'image/gif', extension: '.gif' };
    }
    if (
      bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
      bytes.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
      return { mediaType: 'image/webp', extension: '.webp' };
    }
    throw new Error(`unsupported or invalid image attachment: ${path}`);
  } finally {
    await handle.close();
  }
}
