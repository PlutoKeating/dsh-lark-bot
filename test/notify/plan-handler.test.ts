import { describe, expect, it, vi } from 'vitest';
import { PlanApprovalRegistry } from '../../src/bot/plan-approvals.js';
import { ScopeDirectory } from '../../src/bridge/scope-directory.js';
import { buildPlanHandler } from '../../src/notify/plan-handler.js';
import { SessionStore } from '../../src/session/store.js';

describe('buildPlanHandler', () => {
  it('sends the full plan before the decision card and returns feedback', async () => {
    const sessions = new SessionStore(':memory:');
    sessions.set('chat-a', 'session-1', '/tmp/project');
    const directory = new ScopeDirectory(':memory:');
    directory.register('chat-a', 'oc_group', 'oc_thread');
    const plans = new PlanApprovalRegistry();
    const order: string[] = [];
    const sendMarkdown = vi.fn(async (_chatId: string, _markdown: string, _options?: unknown) => {
      order.push('plan');
    });
    const sendCard = vi.fn(async (_chatId: string, _card: object, _options?: unknown) => {
      order.push('card');
      return 'card-1';
    });
    const handler = buildPlanHandler({
      sessions,
      scopeDirectory: directory,
      plans,
      channel: { sendMarkdown, sendCard },
    });

    const resultPromise = handler({
      token: 't',
      sessionId: 'session-1',
      plan: '## Plan\n\n1. Inspect git@github.com:org/repo.git\n2. Change',
    });
    await vi.waitFor(() => expect(sendCard).toHaveBeenCalledOnce());
    expect(order).toEqual(['plan', 'card']);
    expect(sendMarkdown).toHaveBeenCalledWith(
      'oc_group',
      '## Plan\n\n1. Inspect [redacted-email]:org/repo.git\n2. Change',
      { threadId: 'oc_thread' },
    );
    const serialized = JSON.stringify(sendCard.mock.calls[0]?.[1]);
    const id = /"id":"([^"]+)"/.exec(serialized)?.[1];
    expect(id).toBeTruthy();
    plans.resolve('chat-a', id!, { decision: 'revise', feedback: 'keep it read-only' });
    await expect(resultPromise).resolves.toEqual({
      ok: true,
      decision: 'revise',
      feedback: 'keep it read-only',
    });
  });

  it('rejects unknown sessions without sending anything', async () => {
    const sendMarkdown = vi.fn();
    const sendCard = vi.fn();
    const handler = buildPlanHandler({
      sessions: new SessionStore(':memory:'),
      scopeDirectory: new ScopeDirectory(':memory:'),
      plans: new PlanApprovalRegistry(),
      channel: { sendMarkdown, sendCard },
    });
    await expect(handler({ token: 't', sessionId: 'missing', plan: 'Plan' })).resolves.toEqual({
      ok: false,
      error: 'unknown session: missing',
    });
    expect(sendMarkdown).not.toHaveBeenCalled();
    expect(sendCard).not.toHaveBeenCalled();
  });

  it('cancels only its gate and recalls the stale card when the request aborts', async () => {
    const sessions = new SessionStore(':memory:');
    sessions.set('chat-a', 'session-1', '/tmp/project');
    const directory = new ScopeDirectory(':memory:');
    directory.register('chat-a', 'oc_group', undefined);
    const plans = new PlanApprovalRegistry();
    const sendMarkdown = vi.fn(async () => undefined);
    const sendCard = vi.fn(async () => 'card-1');
    const recallMessage = vi.fn(async () => undefined);
    const handler = buildPlanHandler({
      sessions,
      scopeDirectory: directory,
      plans,
      channel: { sendMarkdown, sendCard, recallMessage },
    });
    const controller = new AbortController();

    const result = handler(
      { token: 't', sessionId: 'session-1', plan: 'Plan' },
      controller.signal,
    );
    await vi.waitFor(() => expect(sendCard).toHaveBeenCalledOnce());
    controller.abort();

    await expect(result).resolves.toEqual({ ok: false, error: 'plan approval cancelled' });
    expect(plans.pendingCount('chat-a', 'session-1')).toBe(0);
    expect(sendMarkdown).toHaveBeenLastCalledWith(
      'oc_group',
      expect.stringContaining('计划确认已取消'),
      undefined,
    );
    expect(recallMessage).toHaveBeenCalledWith('card-1');
  });

  it('does not register or send a card when abort happens while the plan message is sending', async () => {
    const sessions = new SessionStore(':memory:');
    sessions.set('chat-a', 'session-1', '/tmp/project');
    const directory = new ScopeDirectory(':memory:');
    directory.register('chat-a', 'oc_group', undefined);
    const plans = new PlanApprovalRegistry();
    let releasePlan: (() => void) | undefined;
    let firstSend = true;
    const sendMarkdown = vi.fn(async () => {
      if (!firstSend) return;
      firstSend = false;
      await new Promise<void>((resolve) => { releasePlan = resolve; });
    });
    const sendCard = vi.fn(async () => 'card-1');
    const handler = buildPlanHandler({
      sessions,
      scopeDirectory: directory,
      plans,
      channel: { sendMarkdown, sendCard },
    });
    const controller = new AbortController();

    const result = handler(
      { token: 't', sessionId: 'session-1', plan: 'Plan' },
      controller.signal,
    );
    await vi.waitFor(() => expect(sendMarkdown).toHaveBeenCalledOnce());
    controller.abort();
    releasePlan?.();

    await expect(result).resolves.toEqual({ ok: false, error: 'plan approval cancelled' });
    expect(sendCard).not.toHaveBeenCalled();
    expect(plans.pendingCount('chat-a', 'session-1')).toBe(0);
    expect(sendMarkdown).toHaveBeenCalledTimes(2);
    expect(sendMarkdown).toHaveBeenLastCalledWith(
      'oc_group',
      expect.stringContaining('计划确认已取消'),
      undefined,
    );
  });
});
