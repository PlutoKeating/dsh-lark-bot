import { readFile } from 'node:fs/promises';
import { writeFileAtomic } from '../platform/atomic-write.js';

/**
 * Safety-net guardian heartbeat.
 *
 * The bridge engine (running inside the dsh process) writes a small JSON
 * heartbeat file under the bridge profile directory every few seconds. The
 * guardian — a separate, minimal process — only trusts a fresh heartbeat (or
 * a live dsh process) as "dsh is up"; when the heartbeat goes stale AND no
 * dsh process is observable, the guardian takes over the Feishu channel.
 *
 * The heartbeat is deliberately tiny and dependency-free so the guardian can
 * read it without importing the bridge, sessions, adapters or any plugin.
 */

export interface HeartbeatPayload {
  pid: number;
  startedAt: string;
  ts: number;
}

export const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;

export async function readHeartbeat(
  file: string,
): Promise<HeartbeatPayload | undefined> {
  try {
    const raw = await readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as Partial<HeartbeatPayload>;
    if (
      typeof parsed.pid !== 'number' ||
      typeof parsed.startedAt !== 'string' ||
      typeof parsed.ts !== 'number'
    ) {
      return undefined;
    }
    return {
      pid: parsed.pid,
      startedAt: parsed.startedAt,
      ts: parsed.ts,
    };
  } catch {
    return undefined;
  }
}

export function heartbeatAgeMs(
  payload: HeartbeatPayload,
  now: number = Date.now(),
): number {
  return Math.max(0, now - payload.ts);
}

export function isHeartbeatFresh(
  payload: HeartbeatPayload | undefined,
  maxAgeMs: number,
  now: number = Date.now(),
): boolean {
  if (payload === undefined) return false;
  return heartbeatAgeMs(payload, now) < maxAgeMs;
}

export interface HeartbeatHandle {
  stop(): void;
}

/**
 * Write a heartbeat immediately and then every `intervalMs`. Returns a handle
 * whose `stop()` clears the timer. Failures are swallowed (the guardian treats
 * a stale/missing heartbeat as "dsh is down", which is the safe failure mode).
 */
export function startHeartbeat(
  file: string,
  pid: number,
  intervalMs: number = DEFAULT_HEARTBEAT_INTERVAL_MS,
): HeartbeatHandle {
  const startedAt = new Date().toISOString();
  let stopped = false;

  const beat = async (): Promise<void> => {
    if (stopped) return;
    const payload: HeartbeatPayload = { pid, startedAt, ts: Date.now() };
    try {
      await writeFileAtomic(file, `${JSON.stringify(payload)}\n`, {
        mode: 0o600,
      });
    } catch {
      // A failed write must never take the bridge down; the guardian will see
      // the stale/missing heartbeat and take over when appropriate.
    }
  };

  void beat();
  const timer = setInterval(() => {
    void beat();
  }, intervalMs);
  timer.unref?.();

  return {
    stop(): void {
      stopped = true;
      clearInterval(timer);
    },
  };
}
