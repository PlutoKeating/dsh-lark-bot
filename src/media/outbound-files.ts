import { constants } from 'node:fs';
import { open, realpath, stat, type FileHandle } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';

export const DEFAULT_OUTBOUND_FILE_MAX_BYTES = 20 * 1024 * 1024;

export interface PreparedOutboundFile {
  fileName: string;
  content: Buffer;
  size: number;
  path: string;
}

export async function prepareOutboundFile(input: {
  path: string;
  baseDir: string;
  allowedRoots: readonly string[];
  fileName?: string;
  maxBytes?: number;
}): Promise<PreparedOutboundFile> {
  const requested = isAbsolute(input.path) ? resolve(input.path) : resolve(input.baseDir, input.path);
  let actual: string;
  try {
    actual = await realpath(requested);
  } catch {
    throw new Error(`file does not exist: ${input.path}`);
  }
  const roots = await Promise.all(input.allowedRoots.map(async (root) => {
    try {
      return await realpath(root);
    } catch {
      return resolve(root);
    }
  }));
  if (!roots.some((root) => isPathWithin(actual, root))) {
    throw new Error('file is outside the current workspace and approved output directories');
  }
  const maxBytes = input.maxBytes ?? DEFAULT_OUTBOUND_FILE_MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error('outbound file size limit must be a positive safe integer');
  }
  const fileName = input.fileName?.trim() || basename(actual);
  if (fileName !== basename(fileName) || /[\\/]/.test(fileName) || fileName === '.' || fileName === '..') {
    throw new Error('fileName must be a plain file name without path separators');
  }
  const handle = await open(actual, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat({ bigint: true });
    if (!info.isFile()) throw new Error('outbound path must be a regular file');
    if (info.size > BigInt(maxBytes)) {
      throw new Error(`file is too large: ${String(info.size)} bytes (limit ${String(maxBytes)} bytes)`);
    }

    // The runtime can mutate its workspace concurrently. Re-resolve the path
    // after opening and compare the opened identity with the path identity so
    // a parent-directory or final-component swap cannot redirect the read.
    const verifiedPath = await realpath(actual);
    if (!roots.some((root) => isPathWithin(verifiedPath, root))) {
      throw new Error('file changed to a path outside approved output directories');
    }
    const pathInfo = await stat(verifiedPath, { bigint: true });
    if (pathInfo.dev !== info.dev || pathInfo.ino !== info.ino) {
      throw new Error('file changed while it was being opened');
    }

    const content = await readBounded(handle, maxBytes);
    return { fileName, content, size: content.length, path: verifiedPath };
  } finally {
    await handle.close();
  }
}

async function readBounded(handle: FileHandle, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  while (total <= maxBytes) {
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1 - total));
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, total);
    if (bytesRead === 0) break;
    chunks.push(chunk.subarray(0, bytesRead));
    total += bytesRead;
  }
  if (total > maxBytes) {
    throw new Error(`file is too large: more than ${String(maxBytes)} bytes`);
  }
  return Buffer.concat(chunks, total);
}

function isPathWithin(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}
