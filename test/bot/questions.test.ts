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
});
