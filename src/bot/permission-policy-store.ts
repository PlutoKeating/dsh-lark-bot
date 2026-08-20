import { readFile } from 'node:fs/promises';
import { log } from '../core/logger.js';
import { writeFileAtomic } from '../platform/atomic-write.js';

export type PermissionPolicy = 'ask' | 'allow' | 'deny';

interface PermissionPolicyData {
  schemaVersion: 1;
  scopes: Record<string, PermissionPolicy>;
}

/** Persistent tool-approval policy keyed by the bridge's isolated scope. */
export class PermissionPolicyStore {
  private data: PermissionPolicyData = { schemaVersion: 1, scopes: {} };
  private saving: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Partial<PermissionPolicyData>;
      this.data = {
        schemaVersion: 1,
        scopes: Object.fromEntries(
          Object.entries(parsed.scopes ?? {}).filter((entry): entry is [string, PermissionPolicy] =>
            entry[1] === 'ask' || entry[1] === 'allow' || entry[1] === 'deny'),
        ),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.data = { schemaVersion: 1, scopes: {} };
    }
  }

  get(scope: string): PermissionPolicy {
    return this.data.scopes[scope] ?? 'ask';
  }

  async set(scope: string, policy: PermissionPolicy): Promise<void> {
    const persist = this.saving.then(async () => {
      const previous = this.data.scopes[scope];
      if (policy === 'ask') delete this.data.scopes[scope];
      else this.data.scopes[scope] = policy;
      const snapshot: PermissionPolicyData = {
        schemaVersion: 1,
        scopes: { ...this.data.scopes },
      };
      try {
        await writeFileAtomic(this.path, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
      } catch (error) {
        if (previous === undefined) delete this.data.scopes[scope];
        else this.data.scopes[scope] = previous;
        log.fail('permission-policy-store', error, { step: 'persist', scope });
        throw error;
      }
    });
    this.saving = persist.catch(() => undefined);
    await persist;
  }

  async flush(): Promise<void> {
    await this.saving;
  }
}
