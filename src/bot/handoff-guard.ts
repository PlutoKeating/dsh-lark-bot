import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { writeFileAtomic } from '../platform/atomic-write.js';
import { withFileLock } from '../platform/file-lock.js';

interface HandoffState {
  count: number;
  messageIds: string[];
  tripped: boolean;
  updatedAt: string;
}

interface HandoffFile {
  schemaVersion: 1;
  chats: Record<string, HandoffState>;
}

export interface HandoffDecision {
  allowed: boolean;
  firstTrip: boolean;
  count: number;
}

/** Cross-process exact counter: only trusted peer messages are recorded by callers. */
export class BotHandoffGuard {
  constructor(private readonly path: string) {}

  async recordHuman(chatId: string): Promise<void> {
    await this.withLock(async () => {
      const data = await this.read();
      if (!data.chats[chatId]) return;
      delete data.chats[chatId];
      await this.write(data);
    });
  }

  async recordBot(chatId: string, messageId: string, max: number): Promise<HandoffDecision> {
    return this.withLock(async () => {
      const data = await this.read();
      const current = data.chats[chatId] ?? {
        count: 0, messageIds: [], tripped: false, updatedAt: new Date(0).toISOString(),
      };
      if (current.messageIds.includes(messageId)) {
        return { allowed: current.count <= max, firstTrip: false, count: current.count };
      }
      const count = current.count + 1;
      const firstTrip = count > max && !current.tripped;
      data.chats[chatId] = {
        count,
        messageIds: [...current.messageIds.slice(-63), messageId],
        tripped: current.tripped || count > max,
        updatedAt: new Date().toISOString(),
      };
      await this.write(data);
      return { allowed: count <= max, firstTrip, count };
    });
  }

  private async read(): Promise<HandoffFile> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Partial<HandoffFile>;
      return { schemaVersion: 1, chats: parsed.chats ?? {} };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return { schemaVersion: 1, chats: {} };
    }
  }

  private async write(data: HandoffFile): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFileAtomic(this.path, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    return withFileLock(
      `${this.path}.lock`,
      '机器人交接计数器正忙；为避免绕过轮数上限，本次交接已拒绝。',
      operation,
    );
  }
}
