import { readFile } from 'node:fs/promises';
import { writeFileAtomic } from '../platform/atomic-write.js';
import { log } from '../core/logger.js';

export interface SessionRecord {
  sessionId: string | undefined;
  cwd: string;
  messages: ChatMessage[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
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

  set(scopeId: string, sessionId: string | undefined, cwd: string): void {
    const existing = this.data.chats[scopeId];
    this.data.chats[scopeId] = {
      sessionId: sessionId ?? existing?.sessionId,
      cwd,
      messages: existing?.messages ?? [],
    };
    this.schedulePersist();
  }

  historyFor(scopeId: string, cwd: string): ChatMessage[] {
    const record = this.data.chats[scopeId];
    return record && record.cwd === cwd ? record.messages : [];
  }

  recordExchange(
    scopeId: string,
    cwd: string,
    userMessages: string[],
    assistantMessage: string | undefined,
  ): void {
    const existing = this.data.chats[scopeId];
    const next: ChatMessage[] = [...(existing?.messages ?? [])];

    for (const content of userMessages) {
      if (content.trim()) next.push({ role: 'user', content });
    }

    if (assistantMessage?.trim()) {
      next.push({ role: 'assistant', content: assistantMessage });
    }

    this.data.chats[scopeId] = {
      sessionId: existing?.sessionId,
      cwd,
      messages: next.slice(-40),
    };
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
      chats: Object.fromEntries(
        Object.entries(this.data.chats).map(([key, record]) => [
          key,
          {
            ...record,
            messages: [...record.messages],
          },
        ]),
      ),
    };
  }
}
