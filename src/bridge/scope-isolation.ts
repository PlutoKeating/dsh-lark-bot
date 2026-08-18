import type { ScopeIsolationMode } from '../bot/isolation-store.js';

export interface ScopeIdentity {
  chatId: string;
  chatMode: 'p2p' | 'group' | 'topic';
  threadId?: string;
  senderId?: string;
}

/** Resolve the durable state key without mutating or migrating any existing scope. */
export function isolatedScope(identity: ScopeIdentity, mode: ScopeIsolationMode): string {
  if (identity.chatMode === 'p2p') return identity.chatId;
  if (mode === 'group') return identity.chatId;
  if (mode === 'member') {
    if (!identity.senderId) {
      throw new Error('member isolation requires a sender identity');
    }
    return `${identity.chatId}:member:${identity.senderId}`;
  }
  if (mode === 'topic' && identity.threadId) {
    return `${identity.chatId}:${identity.threadId}`;
  }
  return identity.chatId;
}

/** All scopes the same actor can have used before/after an isolation switch. */
export function reachableScopes(identity: ScopeIdentity): string[] {
  if (identity.chatMode === 'p2p') return [identity.chatId];
  const scopes = [identity.chatId];
  if (identity.threadId) scopes.push(`${identity.chatId}:${identity.threadId}`);
  if (identity.senderId) scopes.push(`${identity.chatId}:member:${identity.senderId}`);
  return [...new Set(scopes)];
}

/** Recover the member owner from the immutable scope chosen at enqueue time. */
export function memberOwnerForScope(scope: string, chatId: string): string | undefined {
  const prefix = `${chatId}:member:`;
  return scope.startsWith(prefix) && scope.length > prefix.length
    ? scope.slice(prefix.length)
    : undefined;
}
