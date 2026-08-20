import { readFile } from 'node:fs/promises';
import { writeFileAtomic } from '../platform/atomic-write.js';
import { log } from '../core/logger.js';

export type ScopeIsolationMode = 'group' | 'topic' | 'member';

interface IsolationData {
  schemaVersion: 1;
  chats: Record<string, ScopeIsolationMode>;
}

/** Persistent per-chat scope isolation policy. Missing entries preserve the legacy topic behavior. */
export class IsolationStore {
  private data: IsolationData = { schemaVersion: 1, chats: {} };
  private saving: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Partial<IsolationData>;
      this.data = {
        schemaVersion: 1,
        chats: Object.fromEntries(
          Object.entries(parsed.chats ?? {}).filter((entry): entry is [string, ScopeIsolationMode] =>
            entry[1] === 'group' || entry[1] === 'topic' || entry[1] === 'member'),
        ),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.data = { schemaVersion: 1, chats: {} };
    }
  }

  get(chatId: string): ScopeIsolationMode {
    return this.data.chats[chatId] ?? 'topic';
  }

  set(chatId: string, mode: ScopeIsolationMode): void {
    this.data.chats[chatId] = mode;
    this.schedulePersist();
  }

  async flush(): Promise<void> {
    await this.saving;
  }

  private schedulePersist(): void {
    const snapshot: IsolationData = {
      schemaVersion: 1,
      chats: { ...this.data.chats },
    };
    this.saving = this.saving
      .then(() => writeFileAtomic(this.path, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 }))
      .catch((error: unknown) => log.fail('isolation-store', error, { step: 'persist' }));
  }
}
