import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Session self-heal classification.
 *
 * The persisted dsh session log can disagree with the live session in two
 * ways, and they must be handled differently:
 *
 * - `broken`: the persisted log does not match the live session (id
 *   collision / stale live session). The log itself is fine — reset the
 *   scope binding so the next run starts fresh, keep the history.
 * - `corrupt`: the persisted log is unreadable / has a sequence gap. Copy
 *   it out of `$DSH_HOME/sessions` (archive) before resetting so the
 *   conversation stays recoverable.
 *
 * Classification is anchored to the canonical runtime messages so unrelated
 * text (model output, tool results, log passthrough) can never accidentally
 * trigger a reset or archive.
 */
export type SessionHealKind = 'corrupt' | 'broken';

const BROKEN_ANCHORED =
  /session\s+["'`]?[A-Za-z0-9_-]+["'`]?\s+already has a persisted log(?: on disk)? that does not match this live session(?: \(id collision\))?|does not match this live session\s*\(id collision\)/i;

const CORRUPT_ANCHORED =
  /corrupt(?:ed)? session log|session log[^\n]{0,80}?\bseq(?:uence)? gap\b|\bseq(?:uence)? gap\b[^\n]{0,80}?session log/i;

/** Classify a session error into a heal kind, or `undefined` when unrelated. */
export function classifySessionError(message: string): SessionHealKind | undefined {
  if (BROKEN_ANCHORED.test(message)) return 'broken';
  if (CORRUPT_ANCHORED.test(message)) return 'corrupt';
  return undefined;
}

export interface ArchiveSessionResult {
  found: boolean;
  archivePath?: string;
}

/**
 * Copy a session directory out of `$DSH_HOME/sessions` into
 * `~/.dsh-lark/_archived-sessions/<id>-<ts>` and only then remove the
 * original, so a partial copy can never lose history and the archive copy is
 * the recovery source. Returns the archive path for the caller to surface to
 * the user (auditable + recoverable).
 */
export async function archiveSessionDir(
  sessionId: string,
): Promise<ArchiveSessionResult> {
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
  if (found === undefined) return { found: false };

  const larkHome = process.env.DSH_LARK_HOME?.trim() || join(home, '.dsh-lark');
  const bakRoot = join(larkHome, '_archived-sessions');
  const archivePath = join(bakRoot, `${sessionId}-${Date.now()}`);
  await mkdir(bakRoot, { recursive: true });
  await cp(found, archivePath, { recursive: true, force: true });
  await rm(found, { recursive: true, force: true });
  return { found: true, archivePath };
}
