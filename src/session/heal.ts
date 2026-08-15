import { mkdir, readdir, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Error classes that mean the persisted session does not match the live one
 * (e.g. a second runtime resumed it, or a stale live session overlapped it).
 * These are NOT log corruption: the log must be preserved so the conversation
 * stays recoverable. Only a genuine `corrupt session log / seq gap` is
 * archived (see {@link SESSION_CORRUPT_RE}).
 */
export const SESSION_BROKEN_RE =
  /id collision|corrupt session log|already has a persisted log|does not match this live session/i;

/** Errors that mean the log itself is unreadable/inconsistent. */
export const SESSION_CORRUPT_RE = /corrupt session log|seq gap/i;

/**
 * Move a session directory out of `$DSH_HOME/sessions` into
 * `~/.dsh-lark/_archived-sessions/<id>-<ts>` so the heal can reset the chat
 * mapping without destroying the conversation history.
 * @returns true when the directory was found and moved.
 */
export async function archiveSessionDir(sessionId: string): Promise<boolean> {
  const home = homedir();
  const dshHome = process.env.DSH_HOME?.trim() || join(home, '.dsh');
  const root = join(dshHome, 'sessions');

  const walk = async (dir: string): Promise<string | undefined> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return undefined;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === sessionId) return full;
        const found = await walk(full);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  };

  const found = await walk(root);
  if (found === undefined) return false;

  const larkHome = process.env.DSH_LARK_HOME?.trim() || join(home, '.dsh-lark');
  const bakRoot = join(larkHome, '_archived-sessions');
  await mkdir(bakRoot, { recursive: true });
  await rename(found, join(bakRoot, `${sessionId}-${Date.now()}`));
  return true;
}
