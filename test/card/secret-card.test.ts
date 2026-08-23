import { describe, expect, it } from 'vitest';
import { renderSecretCard } from '../../src/card/secret-card.js';

describe('secret card', () => {
  it('uses an owner-bound password form and contains no secret value', () => {
    const card = JSON.stringify(renderSecretCard({ id: 'secret-1', scope: 'chat', ownerId: 'ou_owner', target: 'dsh-credential', reference: 'KEY', purpose: 'auth', createdAt: 1 }));
    expect(card).toContain('"input_type":"password"');
    expect(card).toContain('"cmd":"secret-submit"');
    expect(card).not.toContain('sentinel-secret');
  });
});
