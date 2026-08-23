import { describe, expect, it, vi } from 'vitest';
import { SecretRequestRegistry, type SecretTargetWriter } from '../../src/secret/registry.js';

const SENTINEL = 'SECRET_SENTINEL_MUST_NOT_ESCAPE';

describe('SecretRequestRegistry', () => {
  it('writes a whitelisted target once and returns only a redacted receipt', async () => {
    const writer: SecretTargetWriter = {
      validate: vi.fn(), set: vi.fn().mockResolvedValue(undefined), remove: vi.fn(), configured: vi.fn(),
    };
    const registry = new SecretRequestRegistry(writer);
    const pending = registry.register({
      scope: 'chat-a', ownerId: 'admin-a', target: 'dsh-credential', reference: 'OPENAI_API_KEY',
      purpose: 'authenticate provider',
    });
    const receipt = await registry.submit({
      scope: 'chat-a', id: pending.id, operatorId: 'admin-a', value: SENTINEL,
    });
    expect(writer.set).toHaveBeenCalledWith('dsh-credential', 'OPENAI_API_KEY', SENTINEL);
    expect(JSON.stringify(receipt)).not.toContain(SENTINEL);
    await expect(pending.promise).resolves.toEqual(receipt);
    await expect(registry.submit({ scope: 'chat-a', id: pending.id, operatorId: 'admin-a', value: SENTINEL }))
      .resolves.toMatchObject({ ok: false });
  });

  it('rejects cross-scope/operator, invalid targets, expiry and empty values without writes', async () => {
    const writer: SecretTargetWriter = {
      validate: vi.fn((target) => { if (target === 'arbitrary-path') throw new Error('unsupported secret target'); }),
      set: vi.fn(), remove: vi.fn(), configured: vi.fn(),
    };
    const registry = new SecretRequestRegistry(writer, { ttlMs: 10, now: () => 100 });
    expect(() => registry.register({ scope: 's', ownerId: 'a', target: 'arbitrary-path' as never,
      reference: '/tmp/file', purpose: 'bad' })).toThrow('unsupported secret target');
    const pending = registry.register({ scope: 's', ownerId: 'a', target: 'app-secret', reference: 'current', purpose: 'rotate' });
    await expect(registry.submit({ scope: 'other', id: pending.id, operatorId: 'a', value: SENTINEL, now: 100 }))
      .resolves.toMatchObject({ ok: false });
    await expect(registry.submit({ scope: 's', id: pending.id, operatorId: 'other', value: SENTINEL, now: 100 }))
      .resolves.toMatchObject({ ok: false });
    await expect(registry.submit({ scope: 's', id: pending.id, operatorId: 'a', value: '', now: 100 }))
      .resolves.toMatchObject({ ok: false });
    await expect(registry.submit({ scope: 's', id: pending.id, operatorId: 'a', value: SENTINEL, now: 111 }))
      .resolves.toMatchObject({ ok: false });
    expect(writer.set).not.toHaveBeenCalled();
  });
});
