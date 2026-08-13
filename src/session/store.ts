import { readFile } from 'node:fs/promises';
import { writeFileAtomic } from '../platform/atomic-write.js';
import { log } from '../core/logger.js';

export interface SessionRecord {
  sessionId: string;
  cwd: string;
}

interface SessionData {
  chats: Record<string, SessionRecord>;
}

export class SessionStore {
  private data: SessionData = { chats: {} };
  private saving: Promise<void> = Promise.resolve();
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw) as Partial<SessionData>;
      this.data = {
        chats: parsed.chats ?? {},
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }

  getRaw(scopeId: string): SessionRecord | undefined {
    return this.data.chats[scopeId];
  }

  set(scopeId: string, sessionId: string, cwd: string): void {
    this.data.chats[scopeId] = { sessionId, cwd };
    this.schedulePersist();
  }

  clear(scopeId: string): boolean {
    if (!(scopeId in this.data.chats)) return false;
    delete this.data.chats[scopeId];
    this.schedulePersist();
    return true;
  }

  resumeFor(scopeId: string, cwd: string): string | undefined {
    const record = this.data.chats[scopeId];
    return record && record.cwd === cwd ? record.sessionId : undefined;
  }

  async flush(): Promise<void> {
    await this.saving;
  }

  private schedulePersist(): void {
    const snapshot = this.snapshot();
    this.saving = this.saving
      .then(async () => {
        await writeFileAtomic(this.path, `${JSON.stringify(snapshot, null, 2)}\n`, {
          mode: 0o600,
        });
      })
      .catch((error: unknown) => {
        log.fail('session', error, { step: 'persist' });
      });
  }

  private snapshot(): SessionData {
    return {
      chats: { ...this.data.chats },
    };
  }
}
