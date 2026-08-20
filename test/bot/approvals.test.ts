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

  it('settles and counts only approvals owned by one concurrent session', async () => {
    const registry = new ApprovalRegistry();
    const sessionA = registry.register('chat-a', request('call-a'), 'session-a');
    const sessionB = registry.register('chat-a', request('call-b'), 'session-b');
    expect(registry.pendingCount('chat-a', 'session-a')).toBe(1);
    expect(registry.settleSession('chat-a', 'session-b', 'cancelled')).toBe(1);
    await expect(sessionB).resolves.toBe('cancelled');
    expect(registry.pendingCount('chat-a', 'session-a')).toBe(1);
    expect(registry.resolve('chat-a', 'call-a', 'allowed-once')).toBe(true);
    await expect(sessionA).resolves.toBe('allowed-once');
  });

  it('cancels one failed card without affecting another request', async () => {
    const registry = new ApprovalRegistry();
    const first = registry.register('chat-a', request('call-a'), 'session-a');
    const second = registry.register('chat-a', request('call-b'), 'session-b');
    expect(registry.cancel('chat-a', 'call-b')).toBe(true);
    await expect(second).resolves.toBe('cancelled');
    expect(registry.pendingCount('chat-a')).toBe(1);
    registry.resolve('chat-a', 'call-a', 'rejected');
    await expect(first).resolves.toBe('rejected');
  });

  it('does not treat a topic/member scope prefix as the parent chat scope', async () => {
    const registry = new ApprovalRegistry();
    const topic = registry.register('chat-a:thread-a', request('call-topic'), 'session-topic');
    expect(registry.settleAll('chat-a', 'cancelled')).toBe(0);
    expect(registry.pendingCount('chat-a')).toBe(0);
    expect(registry.pendingCount('chat-a:thread-a')).toBe(1);
    registry.resolve('chat-a:thread-a', 'call-topic', 'allowed-once');
    await expect(topic).resolves.toBe('allowed-once');
  });
});
