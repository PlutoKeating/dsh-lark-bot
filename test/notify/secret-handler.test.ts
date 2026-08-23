import { describe, expect, it, vi } from 'vitest';
import { buildSecretHandler } from '../../src/notify/secret-handler.js';
import { SecretRequestRegistry } from '../../src/secret/registry.js';

function harness(actor: string | undefined, admin = true) {
  const set = vi.fn().mockResolvedValue(undefined);
  const requests = new SecretRequestRegistry({ validate: vi.fn(), set, remove: vi.fn(), configured: vi.fn() });
  const sendCard = vi.fn(async (_chatId: string, card: object) => {
    const serialized = JSON.stringify(card);
    const id = /"id":"([^"]+)"/.exec(serialized)?.[1];
    if (id) queueMicrotask(() => void requests.submit({ scope: 'chat-a', id, operatorId: actor, value: 'sentinel-local-only' }));
    return 'message-1';
  });
  const handler = buildSecretHandler({
    sessions: { scopeForSession: () => 'chat-a' } as never,
    scopes: { resolve: () => ({ chatId: 'chat-a', threadId: undefined, messageId: 'message-0' }) } as never,
    requests, actorForSession: () => actor, isAdmin: () => admin, sendCard,
  });
  return { handler, set, sendCard };
}

describe('secret callback handler', () => {
  it('requires the current session actor to be an administrator', async () => {
    const { handler, sendCard } = harness('ou_member', false);
    await expect(handler({ token: 't', sessionId: 's', target: 'dsh-credential', reference: 'KEY' })).resolves.toEqual({ ok: false, error: 'administrator required' });
    expect(sendCard).not.toHaveBeenCalled();
  });

  it('returns configured metadata while the submitted value stays local', async () => {
    const { handler, set } = harness('ou_admin');
    const result = await handler({ token: 't', sessionId: 's', target: 'dsh-credential', reference: 'KEY', purpose: 'auth' });
    expect(set).toHaveBeenCalledWith('dsh-credential', 'KEY', 'sentinel-local-only');
    expect(result).toEqual({ ok: true, target: 'dsh-credential', reference: 'KEY', configured: true });
    expect(JSON.stringify(result)).not.toContain('sentinel-local-only');
  });
});
