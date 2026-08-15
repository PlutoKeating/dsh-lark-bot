/**
 * Persistent upgrade state (`~/.dsh-lark/upgrade-state.json`).
 *
 * The upgrade command records every run that changed the installation so a
 * later `--rollback` can deterministically reinstall the previous package
 * version (and re-apply the guardian). The file lives under the dsh-lark
 * state root, which is intentionally never touched by the upgrade itself —
 * config, sessions, archives and credentials survive upgrades and rollbacks.
 */

import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { writeFileAtomic } from '../platform/atomic-write.js';

export interface UpgradeRecord {
  /** ISO timestamp of the upgrade. */
  at: string;
  /** Version that was installed before the upgrade. */
  fromVersion: string;
  /** Version that was installed by the upgrade. */
  toVersion: string;
  /** dsh profile the package was upgraded in. */
  profile: string;
  /** `name@version` spec used for the upgrade (also the rollback reinstall uses the previous one). */
  packageSpec: string;
  /** Whether the guardian service was (re)installed as part of the upgrade. */
  guardianInstalled: boolean;
}

export interface UpgradeState {
  schemaVersion: 1;
  /** The most recent upgrade; its `fromVersion` is the rollback target. */
  lastUpgrade: UpgradeRecord;
}

export function upgradeStatePath(root: string): string {
  return join(root, 'upgrade-state.json');
}

export async function loadUpgradeState(
  file: string,
): Promise<UpgradeState | undefined> {
  try {
    const raw = await readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as Partial<UpgradeState>;
    if (parsed.schemaVersion !== 1 || !parsed.lastUpgrade) return undefined;
    return parsed as UpgradeState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return undefined;
  }
}

export async function saveUpgradeState(
  file: string,
  state: UpgradeState,
): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFileAtomic(file, JSON.stringify(state, null, 2));
}
