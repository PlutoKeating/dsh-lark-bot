import { randomBytes } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface AtomicWriteOptions {
  mode?: number;
}

export async function writeFileAtomic(
  target: string,
  data: string,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const directory = dirname(target);
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `.${randomBytes(8).toString('hex')}.tmp`);

  try {
    await writeFile(temporary, data, options.mode === undefined ? undefined : { mode: options.mode });
    await rename(temporary, target);
  } catch (error) {
    await rmSilently(temporary);
    throw error;
  }
}

async function rmSilently(path: string): Promise<void> {
  const { rm } = await import('node:fs/promises');
  try {
    await rm(path, { force: true });
  } catch {
    // best effort cleanup only
  }
}
