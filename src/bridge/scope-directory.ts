import { readFile } from 'node:fs/promises';
import { writeFileAtomic } from '../platform/atomic-write.js';
import { log } from '../core/logger.js';

export interface ScopeEntry {
  scope: string;
  chatId: string;
  threadId: string | undefined;
  /** Latest inbound message that can anchor an outbound reply in this scope. */
  messageId?: string;
  chatMode?: 'p2p' | 'group' | 'topic';
  lastSeenAt: string;
}

interface ScopeData {
  entries: Record<string, ScopeEntry>;
}

/**
 * Persistent scope → chat/thread directory. Every inbound message registers
 * its scope, so the bridge can later push outbound notifications to other
 * chats/topics (cross-session messaging). Persisted per profile at
 * `<profile>/scopes.json` so targets survive restarts.
 */
export class ScopeDirectory {
  private data: ScopeData = { entries: {} };
  private saving: Promise<void> = Promise.resolve();
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw) as Partial<ScopeData>;
      this.data = { entries: parsed.entries ?? {} };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.data = { entries: {} };
    }
  }

  register(
    scope: string,
    chatId: string,
    threadId: string | undefined,
    chatMode?: 'p2p' | 'group' | 'topic',
    messageId?: string,
  ): void {
    const existing = this.data.entries[scope];
    const resolvedChatMode = chatMode ?? existing?.chatMode;
    const anchorMessageId = messageId ?? existing?.messageId;
    this.data.entries[scope] = {
      scope,
      chatId,
      threadId: threadId ?? existing?.threadId,
      ...(anchorMessageId ? { messageId: anchorMessageId } : {}),
      ...(resolvedChatMode ? { chatMode: resolvedChatMode } : {}),
      lastSeenAt: new Date().toISOString(),
    };
    this.schedulePersist();
  }

  /** Resolve a scope key to its chat destination. */
  resolve(scope: string): {
    chatId: string;
    threadId: string | undefined;
    messageId?: string;
  } | undefined {
    const entry = this.data.entries[scope];
    if (!entry) return undefined;
    return {
      chatId: entry.chatId,
      threadId: entry.threadId,
      ...(entry.messageId ? { messageId: entry.messageId } : {}),
    };
  }

  /** Direct chat lookup by chatId (also matches topic scopes by prefix). */
  resolveChat(chatId: string): {
    chatId: string;
    threadId: string | undefined;
    messageId?: string;
  } | undefined {
    if (this.data.entries[chatId]) return this.resolve(chatId);
    const entry = Object.values(this.data.entries).find((item) => item.chatId === chatId);
    return entry
      ? {
          chatId: entry.chatId,
          threadId: entry.threadId,
          ...(entry.messageId ? { messageId: entry.messageId } : {}),
        }
      : undefined;
  }

  knownScopes(): string[] {
    return Object.keys(this.data.entries);
  }

  /** Most recently active destination, used for narrowly scoped service notices. */
  recentDestination(): {
    chatId: string;
    threadId: string | undefined;
    messageId?: string;
  } | undefined {
    const entry = Object.values(this.data.entries).sort(
      (left, right) => Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt),
    )[0];
    if (!entry) return undefined;
    return {
      chatId: entry.chatId,
      threadId: entry.threadId,
      ...(entry.messageId ? { messageId: entry.messageId } : {}),
    };
  }

  /** Unique chats observed by the bridge, including their persisted mode. */
  knownChats(): Array<{
    chatId: string;
    chatMode: 'p2p' | 'group' | 'topic' | undefined;
  }> {
    const chats = new Map<
      string,
      { chatId: string; chatMode: 'p2p' | 'group' | 'topic' | undefined }
    >();
    for (const entry of Object.values(this.data.entries)) {
      const existing = chats.get(entry.chatId);
      chats.set(entry.chatId, {
        chatId: entry.chatId,
        chatMode: entry.chatMode ?? existing?.chatMode,
      });
    }
    return [...chats.values()];
  }

  async flush(): Promise<void> {
    await this.saving;
  }

  private schedulePersist(): void {
    const snapshot = {
      entries: Object.fromEntries(
        Object.entries(this.data.entries).map(([scope, entry]) => [
          scope,
          { ...entry },
        ]),
      ),
    };
    this.saving = this.saving
      .then(async () => {
        await writeFileAtomic(this.path, `${JSON.stringify(snapshot, null, 2)}\n`, {
          mode: 0o600,
        });
      })
      .catch((error: unknown) => {
        log.fail('scope-directory', error, { step: 'persist' });
      });
  }
}
