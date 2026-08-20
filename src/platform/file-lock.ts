import { open, mkdir, readFile, readdir, rm, rmdir, stat, utimes } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';

interface LockLease {
  pid: number;
  token: string;
  createdAt: number;
}

const RETRY_MS = 10;
const RETRIES = 100;
const INIT_GRACE_MS = 250;
const STALE_MS = 30_000;
const HEARTBEAT_MS = 1_000;

/**
 * Small cross-process lease for short atomic JSON mutations.
 *
 * The common path is an atomic owner directory and the ownership token is a
 * uniquely named child. Cleanup only ever removes that exact child before an
 * empty-directory rmdir, so a delayed owner/reaper cannot delete a replacement
 * lease. A heartbeat prevents long live operations from being stolen; dead or
 * abandoned owners remain recoverable.
 */
export async function withFileLock<T>(
  path: string,
  busyMessage: string,
  operation: () => Promise<T>,
): Promise<T> {
  await mkdir(dirname(path), { recursive: true });
  const token = randomUUID();
  const ownerPath = join(path, `${token}.json`);
  for (let attempt = 0; attempt < RETRIES; attempt += 1) {
    let acquired = false;
    try {
      await mkdir(path, { mode: 0o700 });
      try {
        const handle = await open(ownerPath, 'wx', 0o600);
        try {
          await handle.writeFile(`${JSON.stringify({
            pid: process.pid,
            token,
            createdAt: Date.now(),
          } satisfies LockLease)}\n`);
        } finally {
          await handle.close();
        }
      } catch (error) {
        await rmdir(path).catch(() => undefined);
        throw error;
      }
      acquired = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await reclaimAbandoned(path);
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
    if (!acquired) continue;

    const heartbeat = setInterval(() => {
      const now = new Date();
      void utimes(ownerPath, now, now).catch(() => undefined);
    }, HEARTBEAT_MS);
    heartbeat.unref();
    try {
      return await operation();
    } finally {
      clearInterval(heartbeat);
      await rm(ownerPath, { force: true });
      await rmdir(path).catch(() => undefined);
    }
  }
  throw new Error(busyMessage);
}

async function reclaimAbandoned(path: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(path);
  } catch (error) {
    // Pre-directory versions used a common-path file. Deleting it after a
    // separate ownership check would reintroduce the replacement-owner race.
    if ((error as NodeJS.ErrnoException).code === 'ENOTDIR') return;
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return;
  }

  if (entries.length === 0) {
    if (await olderThan(path, INIT_GRACE_MS)) await rmdir(path).catch(() => undefined);
    return;
  }

  for (const entry of entries) {
    const ownerPath = join(path, entry);
    const lease = await readLease(ownerPath);
    const abandoned = lease
      ? !isPidAlive(lease.pid) || await olderThan(ownerPath, STALE_MS)
      : await olderThan(ownerPath, INIT_GRACE_MS);
    if (abandoned) await rm(ownerPath, { force: true });
  }
  // A replacement owner always has its own child, so this cannot remove it.
  await rmdir(path).catch(() => undefined);
}

async function olderThan(path: string, thresholdMs: number): Promise<boolean> {
  try {
    return Date.now() - (await stat(path)).mtimeMs >= thresholdMs;
  } catch {
    return false;
  }
}

async function readLease(path: string): Promise<LockLease | undefined> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as Partial<LockLease>;
    return typeof value.pid === 'number' && typeof value.token === 'string' &&
      typeof value.createdAt === 'number'
      ? value as LockLease
      : undefined;
  } catch {
    return undefined;
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
