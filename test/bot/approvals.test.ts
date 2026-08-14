import { describe, expect, it } from 'vitest';
import { ApprovalRegistry } from '../../src/bot/approvals.js';
import type { ApprovalRequest } from '../../src/adapters/types.js';

function request(id: string): ApprovalRequest {
  return {
    id,
    sessionId: 's1',
    toolName: 'bash',
    reason: 'test',
    options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }],
  };
}

describe('ApprovalRegistry', () => {
  it('resolves a registered request by scope and id', async () => {
    const registry = new ApprovalRegistry();
    const promise = registry.register('chat-a', request('call-1'));
    expect(registry.resolve('chat-a', 'call-1', 'allowed-once')).toBe(true);
    await expect(promise).resolves.toBe('allowed-once');
    expect(registry.resolve('chat-a', 'call-1', 'rejected')).toBe(false);
  });

  it('settles all pending requests when a run ends', async () => {
    const registry = new ApprovalRegistry();
    const promiseA = registry.register('chat-a', request('call-a'));
    const promiseB = registry.register('chat-b', request('call-b'));
    expect(registry.settleAll('chat-a', 'cancelled')).toBe(1);
    await expect(promiseA).resolves.toBe('cancelled');
    expect(registry.pendingCount('chat-a')).toBe(0);
    expect(registry.pendingCount('chat-b')).toBe(1);
    expect(registry.settleAll('chat-b', 'rejected')).toBe(1);
    await expect(promiseB).resolves.toBe('rejected');
  });
});
