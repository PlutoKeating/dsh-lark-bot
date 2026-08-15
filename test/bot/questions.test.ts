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
});
