import { describe, expect, it } from 'vitest';
import { QuestionRegistry } from '../../src/bot/questions.js';

describe('QuestionRegistry', () => {
  it('registers, resolves and settles questions per scope', async () => {
    const registry = new QuestionRegistry();
    const { id, promise } = registry.register('chat-a', {
      kind: 'text',
      question: 'What is your name?',
    });
    expect(registry.get('chat-a', id)?.kind).toBe('text');
    expect(registry.resolve('chat-a', id, 'Ada')).toBe(true);
    await expect(promise).resolves.toBe('Ada');
  });

  it('settles pending questions without answers', async () => {
    const registry = new QuestionRegistry();
    const { id, promise } = registry.register('chat-a', {
      kind: 'single',
      question: 'Pick',
      options: ['x'],
    });
    expect(registry.settleAll('chat-a')).toBe(1);
    await expect(promise).resolves.toBeUndefined();
    expect(registry.get('chat-a', id)).toBeUndefined();
  });

  it('reports pending counts and notifies settlement listeners', async () => {
    const registry = new QuestionRegistry();
    const settled: number[] = [];
    const unsubscribe = registry.onSettled('chat-a', () => {
      settled.push(registry.pendingCount('chat-a'));
    });
    const first = registry.register('chat-a', { kind: 'text', question: 'Q1' });
    const second = registry.register('chat-a', { kind: 'text', question: 'Q2' });
    expect(registry.pendingCount('chat-a')).toBe(2);
    expect(registry.pendingCount('chat-b')).toBe(0);

    expect(registry.resolve('chat-a', first.id, 'A1')).toBe(true);
    expect(settled).toEqual([1]);

    expect(registry.settleAll('chat-a')).toBe(1);
    expect(settled).toEqual([1, 0]);
    await expect(second.promise).resolves.toBeUndefined();

    unsubscribe();
    registry.register('chat-a', { kind: 'text', question: 'Q3' });
    registry.settleAll('chat-a');
    expect(settled).toEqual([1, 0]);
  });

  it('binds card message ids to the exact pending question and removes the binding on settle', async () => {
    const registry = new QuestionRegistry();
    const first = registry.register('chat-a:thread-1', { kind: 'text', question: 'Q1' });
    const second = registry.register('chat-a:thread-1', { kind: 'single', question: 'Q2' });

    expect(registry.bindMessage('chat-a:thread-1', first.id, 'card-1')).toBe(true);
    expect(registry.bindMessage('chat-a:thread-1', second.id, 'card-2')).toBe(true);
    expect(registry.pendingForMessage('card-1')).toEqual({
      scope: 'chat-a:thread-1',
      id: first.id,
      input: expect.objectContaining({ question: 'Q1' }),
    });
    expect(registry.pendingForMessage('card-2')?.id).toBe(second.id);

    expect(registry.resolve('chat-a:thread-1', first.id, 'answer')).toBe(true);
    expect(registry.pendingForMessage('card-1')).toBeUndefined();
    expect(registry.pendingForMessage('card-2')?.id).toBe(second.id);
    registry.settleAll('chat-a:thread-1');
    expect(registry.pendingForMessage('card-2')).toBeUndefined();
    await expect(first.promise).resolves.toBe('answer');
    await expect(second.promise).resolves.toBeUndefined();
  });

  it('settles only questions owned by the completed runtime session', async () => {
    const registry = new QuestionRegistry();
    const first = registry.register('chat-a', { kind: 'text', question: 'Q1' }, 'session-a');
    const second = registry.register('chat-a', { kind: 'text', question: 'Q2' }, 'session-b');
    registry.bindMessage('chat-a', first.id, 'card-a');
    registry.bindMessage('chat-a', second.id, 'card-b');

    expect(registry.settleSession('chat-a', 'session-b')).toBe(1);
    await expect(second.promise).resolves.toBeUndefined();
    expect(registry.pendingForMessage('card-b')).toBeUndefined();
    expect(registry.pendingForMessage('card-a')?.id).toBe(first.id);
    expect(registry.resolve('chat-a', first.id, 'still active')).toBe(true);
    await expect(first.promise).resolves.toBe('still active');
  });

  it('cancels one failed card without touching a concurrent question', async () => {
    const registry = new QuestionRegistry();
    const first = registry.register('chat-a', { kind: 'text', question: 'Q1' }, 'session-a');
    const second = registry.register('chat-a', { kind: 'text', question: 'Q2' }, 'session-b');

    expect(registry.cancel('chat-a', second.id)).toBe(true);
    await expect(second.promise).resolves.toBeUndefined();
    expect(registry.get('chat-a', first.id)).toBeDefined();
    registry.resolve('chat-a', first.id, 'answer');
    await expect(first.promise).resolves.toBe('answer');
  });
});
