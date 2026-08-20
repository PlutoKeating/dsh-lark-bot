import { readFile } from 'node:fs/promises';
import { log } from '../core/logger.js';
import { writeFileAtomic } from '../platform/atomic-write.js';

export type ExecutionMode = 'quick' | 'balanced' | 'deep';

interface ExecutionModeData {
  schemaVersion: 1;
  scopes: Record<string, ExecutionMode>;
}

const MODES = new Set<ExecutionMode>(['quick', 'balanced', 'deep']);

/** Durable execution-strength selection keyed by immutable bridge scope. */
export class ExecutionModeStore {
  private data: ExecutionModeData = { schemaVersion: 1, scopes: {} };
  private saving: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    if (this.path === ':memory:') return;
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Partial<ExecutionModeData>;
      this.data = {
        schemaVersion: 1,
        scopes: Object.fromEntries(
          Object.entries(parsed.scopes ?? {}).filter((entry): entry is [string, ExecutionMode] =>
            MODES.has(entry[1] as ExecutionMode)),
        ),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.data = { schemaVersion: 1, scopes: {} };
    }
  }

  get(scope: string): ExecutionMode {
    return this.data.scopes[scope] ?? 'balanced';
  }

  async set(scope: string, mode: ExecutionMode): Promise<void> {
    if (!MODES.has(mode)) throw new Error('invalid execution mode');
    const persist = this.saving.then(async () => {
      const previous = this.data.scopes[scope];
      if (mode === 'balanced') delete this.data.scopes[scope];
      else this.data.scopes[scope] = mode;
      if (this.path === ':memory:') return;
      try {
        await writeFileAtomic(this.path, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
      } catch (error) {
        if (previous === undefined) delete this.data.scopes[scope];
        else this.data.scopes[scope] = previous;
        log.fail('execution-mode-store', error, { step: 'persist', scope });
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
