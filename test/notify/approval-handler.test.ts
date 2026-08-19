import { describe, expect, it, vi } from 'vitest';
import { ApprovalRegistry } from '../../src/bot/approvals.js';
import { ScopeDirectory } from '../../src/bridge/scope-directory.js';
import { buildApprovalHandler } from '../../src/notify/approval-handler.js';
import { SessionStore } from '../../src/session/store.js';
import type { PermissionPolicyStore } from '../../src/bot/permission-policy-store.js';

describe('buildApprovalHandler', () => {
  it('applies allow and deny policies before creating an SDK/Web approval card', async () => {
    const sessions = new SessionStore(':memory:');
    sessions.set('chat-a', 'session-1', '/tmp/project');
    const directory = new ScopeDirectory(':memory:');
    directory.register('chat-a', 'chat-a', undefined);
    const sendCard = vi.fn();
    const sendMarkdown = vi.fn().mockResolvedValue(undefined);
    const payload = { token: 't', sessionId: 'session-1', toolName: 'bash' };
    const allow = buildApprovalHandler({
      sessions, scopeDirectory: directory, approvals: new ApprovalRegistry(), channel: { sendCard },
      permissionPolicies: { get: () => 'allow' } as unknown as PermissionPolicyStore,
    });
    await expect(allow(payload)).resolves.toEqual({ ok: true, outcome: 'allowed-once' });
    const deny = buildApprovalHandler({
      sessions, scopeDirectory: directory, approvals: new ApprovalRegistry(), channel: { sendCard, sendMarkdown },
      permissionPolicies: { get: () => 'deny' } as unknown as PermissionPolicyStore,
    });
    await expect(deny(payload)).resolves.toEqual({ ok: true, outcome: 'rejected' });
    expect(sendCard).not.toHaveBeenCalled();
    expect(sendMarkdown).toHaveBeenCalledWith('chat-a', expect.stringContaining('deny'), undefined);
  });

  it('routes a default-runtime request to a detailed one-shot card', async () => {
    const sessions = new SessionStore(':memory:');
    sessions.set('chat-a:thread-a', 'session-1', '/tmp/project');
    const directory = new ScopeDirectory(':memory:');
    directory.register('chat-a:thread-a', 'chat-a', 'thread-a', 'topic', 'root-message');
    const approvals = new ApprovalRegistry();
    const sendCard = vi.fn(async (_chatId: string, _card: object, _options?: unknown) => 'approval-card');
    const cancelReminder = vi.fn();
    const onApprovalWaiting = vi.fn(() => cancelReminder);
    const handler = buildApprovalHandler({ sessions, scopeDirectory: directory, approvals, onApprovalWaiting, channel: { sendCard } });

    const result = handler({
      token: 't', sessionId: 'session-1', toolName: 'bash', callId: 'call-1',
      reason: 'Run the requested tests', toolInput: { command: 'pnpm test' },
    });
    await vi.waitFor(() => expect(sendCard).toHaveBeenCalledOnce());
    expect(sendCard).toHaveBeenCalledWith(
      'chat-a', expect.objectContaining({ schema: '2.0' }),
      { threadId: 'thread-a', replyTo: 'root-message' },
    );
    expect(JSON.stringify(sendCard.mock.calls[0]?.[1])).toContain('pnpm test');
    expect(JSON.stringify(sendCard.mock.calls[0]?.[1])).toContain('Allow once');
    expect(JSON.stringify(sendCard.mock.calls[0]?.[1])).toContain('Reject');
    const id = /"cmd":"approve","id":"([^"]+)"/u.exec(
      JSON.stringify(sendCard.mock.calls[0]?.[1]),
    )?.[1];
    expect(id).toBeTruthy();
    approvals.resolve('chat-a:thread-a', id!, 'rejected');
    await expect(result).resolves.toEqual({ ok: true, outcome: 'rejected' });
    expect(onApprovalWaiting).toHaveBeenCalledWith('chat-a:thread-a', 'bash');
    expect(cancelReminder).toHaveBeenCalledOnce();
  });

  it('cancels only its own approval when card delivery fails', async () => {
    const sessions = new SessionStore(':memory:');
    sessions.set('chat-a', 'session-a', '/tmp/project');
    sessions.set('chat-a', 'session-b', '/tmp/project');
    const directory = new ScopeDirectory(':memory:');
    directory.register('chat-a', 'chat-a', undefined);
    const approvals = new ApprovalRegistry();
    const other = approvals.register('chat-a', {
      id: 'other', sessionId: 'session-b', toolName: 'write', reason: undefined, options: [],
    }, 'session-b');
    const handler = buildApprovalHandler({
      sessions, scopeDirectory: directory, approvals,
      channel: { sendCard: vi.fn().mockRejectedValue(new Error('send failed')) },
    });
    await expect(handler({
      token: 't', sessionId: 'session-a', toolName: 'bash', callId: 'failed', reason: 'test',
    })).resolves.toEqual({ ok: false, error: 'send failed' });
    expect(approvals.pendingCount('chat-a', 'session-b')).toBe(1);
    approvals.resolve('chat-a', 'other', 'rejected');
    await expect(other).resolves.toBe('rejected');
  });

  it('cancels, confirms and recalls an approval when the runtime disconnects', async () => {
    const sessions = new SessionStore(':memory:');
    sessions.set('chat-a', 'session-a', '/tmp/project');
    const directory = new ScopeDirectory(':memory:');
    directory.register('chat-a', 'chat-a', undefined);
    const approvals = new ApprovalRegistry();
    const sendMarkdown = vi.fn(async () => undefined);
    const recallMessage = vi.fn(async () => undefined);
    const handler = buildApprovalHandler({
      sessions, scopeDirectory: directory, approvals,
      channel: {
        sendCard: vi.fn(async () => 'approval-card'), sendMarkdown, recallMessage,
      },
    });
    const controller = new AbortController();
    const result = handler({
      token: 't', sessionId: 'session-a', toolName: 'bash', callId: 'call-a', reason: 'test',
    }, controller.signal);
    await vi.waitFor(() => expect(approvals.pendingCount('chat-a', 'session-a')).toBe(1));
    controller.abort();
    await expect(result).resolves.toEqual({ ok: false, error: 'approval cancelled' });
    expect(approvals.pendingCount('chat-a', 'session-a')).toBe(0);
    expect(sendMarkdown).toHaveBeenCalledWith('chat-a', expect.stringContaining('已取消'), undefined);
    expect(recallMessage).toHaveBeenCalledWith('approval-card');
  });
});
