import { describe, expect, it, vi } from 'vitest';
import { buildAskHandler } from '../../src/notify/ask-handler.js';
import { QuestionRegistry } from '../../src/bot/questions.js';
import { SessionStore } from '../../src/session/store.js';
import { ScopeDirectory } from '../../src/bridge/scope-directory.js';

describe('buildAskHandler', () => {
  it('routes a session to its chat, sends a question card and returns the answer', async () => {
    const sessions = new SessionStore(':memory:');
    sessions.set('chat-a', 'session-1', '/tmp/project');
    const directory = new ScopeDirectory(':memory:');
    directory.register('chat-a', 'oc_group', 'oc_thread');
    const questions = new QuestionRegistry();
    const sendCard = vi.fn().mockResolvedValue(undefined);

    const handler = buildAskHandler({ sessions, scopeDirectory: directory, questions, channel: { sendCard } });
    const answerPromise = handler({
      token: 't',
      sessionId: 'session-1',
      question: 'Which plan?',
      kind: 'single',
      options: ['A', 'B'],
    });

    // The card is sent before the handler waits for the answer.
    expect(sendCard).toHaveBeenCalledOnce();
    const card = sendCard.mock.calls[0] as [string, object, unknown];
    expect(card[0]).toBe('oc_group');
    expect(card[2]).toEqual({ threadId: 'oc_thread' });
    // Resolve the registered question the way the card submit path does.
    const registered = JSON.stringify(sendCard.mock.calls[0]?.[1] ?? {});
    const cardId = /"id":"([^"]+)"/.exec(registered)?.[1];
    expect(cardId).toBeTruthy();
    questions.resolve('chat-a', cardId!, 'A');

    await expect(answerPromise).resolves.toEqual({ ok: true, answer: 'A' });
  });

  it('rejects unknown sessions', async () => {
    const sessions = new SessionStore(':memory:');
    const directory = new ScopeDirectory(':memory:');
    const handler = buildAskHandler({
      sessions,
      scopeDirectory: directory,
      questions: new QuestionRegistry(),
      channel: { sendCard: vi.fn() },
    });
    await expect(
      handler({ token: 't', sessionId: 'nope', question: 'Q' }),
    ).resolves.toEqual({ ok: false, error: 'unknown session: nope' });
  });

  it('settles pending questions when the card cannot be sent', async () => {
    const sessions = new SessionStore(':memory:');
    sessions.set('chat-a', 'session-1', '/tmp/project');
    const directory = new ScopeDirectory(':memory:');
    directory.register('chat-a', 'oc_group', undefined);
    const questions = new QuestionRegistry();
    const sendCard = vi.fn().mockRejectedValue(new Error('send failed'));
    const handler = buildAskHandler({
      sessions,
      scopeDirectory: directory,
      questions,
      channel: { sendCard },
    });
    await expect(
      handler({ token: 't', sessionId: 'session-1', question: 'Q' }),
    ).resolves.toEqual({ ok: false, error: 'send failed' });
    expect(questions.pendingCount('chat-a')).toBe(0);
  });
});
