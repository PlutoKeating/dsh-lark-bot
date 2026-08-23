import { describe, expect, it, vi } from 'vitest';
import { attachRunCardAnchors, RunCardAnchors } from '../../src/bridge/run-card-anchors.js';
import type { StreamingChannel } from '../../src/bridge/types.js';

describe('RunCardAnchors', () => {
  it('re-anchors a registered card when a bubble is delivered to the chat', async () => {
    const anchors = new RunCardAnchors();
    const reanchor = vi.fn().mockResolvedValue(undefined);
    const dispose = anchors.register('oc_chat', reanchor);

    await anchors.bubbleSent('oc_chat');
    expect(reanchor).toHaveBeenCalledTimes(1);

    dispose();
    await anchors.bubbleSent('oc_chat');
    expect(reanchor).toHaveBeenCalledTimes(1);
  });

  it('does not fire for chats without a registered card', async () => {
    const anchors = new RunCardAnchors();
    const reanchor = vi.fn().mockResolvedValue(undefined);
    anchors.register('oc_a', reanchor);

    await anchors.bubbleSent('oc_b');
    expect(reanchor).not.toHaveBeenCalled();
  });

  it('does not let a throwing re-anchor break the send path', async () => {
    const anchors = new RunCardAnchors();
    anchors.register('oc_chat', vi.fn().mockRejectedValue(new Error('boom')));

    await expect(anchors.bubbleSent('oc_chat')).resolves.toBeUndefined();
  });
});

describe('attachRunCardAnchors', () => {
  function baseChannel(overrides: Partial<StreamingChannel> = {}): StreamingChannel {
    return {
      sendMarkdown: async () => undefined,
      streamCard: async () => undefined,
      ...overrides,
    };
  }

  it('notifies the anchors after a markdown send', async () => {
    const anchors = new RunCardAnchors();
    const sent: string[] = [];
    const channel = baseChannel({
      sendMarkdown: async (chatId) => {
        sent.push(chatId);
      },
    });
    const wrapped = attachRunCardAnchors(channel, anchors);
    const reanchor = vi.fn().mockResolvedValue(undefined);
    anchors.register('oc_chat', reanchor);

    await wrapped.sendMarkdown('oc_chat', 'progress');

    expect(sent).toEqual(['oc_chat']);
    expect(reanchor).toHaveBeenCalledTimes(1);
  });

  it('notifies the anchors after a card send and returns the message id', async () => {
    const anchors = new RunCardAnchors();
    const channel = baseChannel({
      sendCard: async () => 'card-id',
    });
    const wrapped = attachRunCardAnchors(channel, anchors);
    const reanchor = vi.fn().mockResolvedValue(undefined);
    anchors.register('oc_chat', reanchor);

    const id = await wrapped.sendCard?.('oc_chat', { schema: '2.0' });

    expect(id).toBe('card-id');
    expect(reanchor).toHaveBeenCalledTimes(1);
  });

  it('does not notify when the underlying sendCard is unsupported', async () => {
    const anchors = new RunCardAnchors();
    const channel = baseChannel(); // no sendCard
    const wrapped = attachRunCardAnchors(channel, anchors);
    const reanchor = vi.fn().mockResolvedValue(undefined);
    anchors.register('oc_chat', reanchor);

    const id = await wrapped.sendCard?.('oc_chat', { schema: '2.0' });

    expect(id).toBeUndefined();
    expect(reanchor).not.toHaveBeenCalled();
  });

  it('preserves card operations on the underlying channel', async () => {
    const anchors = new RunCardAnchors();
    const streamCard = vi.fn();
    const updateCard = vi.fn();
    const channel = baseChannel({ streamCard, updateCard });
    const wrapped = attachRunCardAnchors(channel, anchors);

    await wrapped.streamCard('oc_chat', {}, async () => undefined);
    expect(streamCard).toHaveBeenCalledTimes(1);
    await wrapped.updateCard?.('card-1', {});
    expect(updateCard).toHaveBeenCalledTimes(1);
  });
});
