import type { SessionStore } from '../session/store.js';
import type { ScopeDirectory } from '../bridge/scope-directory.js';
import type { SecretRequestRegistry, SecretTargetType } from '../secret/registry.js';
import { renderSecretCard } from '../card/secret-card.js';

export interface SecretPayload { token: string; sessionId: string; target: SecretTargetType; reference: string; purpose?: string }
export interface SecretResult { ok: boolean; target?: SecretTargetType; reference?: string; configured?: boolean; error?: string }

export function buildSecretHandler(deps: {
  sessions: SessionStore; scopes: ScopeDirectory; requests: SecretRequestRegistry;
  actorForSession(sessionId: string): string | undefined; isAdmin(actor: string | undefined): boolean;
  sendCard(chatId: string, card: object, options?: { threadId?: string; replyTo?: string }): Promise<string | undefined>;
}) {
  return async (payload: SecretPayload, signal?: AbortSignal): Promise<SecretResult> => {
    const scope = deps.sessions.scopeForSession(payload.sessionId);
    if (!scope) return { ok: false, error: 'unknown session' };
    const ownerId = deps.actorForSession(payload.sessionId);
    if (!deps.isAdmin(ownerId)) return { ok: false, error: 'administrator required' };
    const destination = deps.scopes.resolve(scope);
    if (!destination) return { ok: false, error: 'unknown scope' };
    if (signal?.aborted) return { ok: false, error: 'cancelled' };
    let request;
    try {
      request = deps.requests.register({ scope, ownerId: ownerId!, target: payload.target, reference: payload.reference, purpose: payload.purpose ?? 'Configure a protected value' });
    } catch { return { ok: false, error: 'invalid target or reference' }; }
    const cancel = () => { deps.requests.cancel(scope, request.id); };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      const view = deps.requests.get(scope, request.id)!;
      try {
        await deps.sendCard(destination.chatId, renderSecretCard(view), destination.threadId && destination.messageId ? { threadId: destination.threadId, replyTo: destination.messageId } : undefined);
      } catch {
        deps.requests.cancel(scope, request.id);
        return { ok: false, error: 'secure form delivery failed' };
      }
      const receipt = await request.promise;
      return receipt.ok
        ? { ok: true, target: payload.target, reference: payload.reference, configured: true }
        : { ok: false, error: receipt.error ?? 'request failed' };
    } finally { signal?.removeEventListener('abort', cancel); }
  };
}
