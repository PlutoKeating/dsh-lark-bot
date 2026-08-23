import { describe, expect, it, vi } from 'vitest';
import { ChannelUpdateController } from '../../src/upgrade/channel-update.js';

describe('ChannelUpdateController', () => {
  it('binds an available-version offer to its scope and administrator before handing it to guardian', async () => {
    const start = vi.fn().mockResolvedValue({ accepted: true, id: 'update-1' });
    const controller = new ChannelUpdateController({
      current: '0.18.0', probe: vi.fn().mockResolvedValue('0.19.0'),
      handoff: { start }, id: () => 'offer-1', now: () => 1_000,
    });
    const offer = await controller.check({ scope: 'chat-a', actorId: 'ou_admin' });

    expect(offer).toEqual({
      kind: 'available', current: '0.18.0', latest: '0.19.0', offerId: 'offer-1',
    });
    await expect(controller.decide({
      offerId: 'offer-1', scope: 'chat-a', actorId: 'ou_other', decision: 'confirm',
      route: { chatId: 'oc_chat', requesterId: 'ou_other' },
    })).resolves.toEqual({ kind: 'stale' });
    await expect(controller.decide({
      offerId: 'offer-1', scope: 'chat-a', actorId: 'ou_admin', decision: 'confirm',
      route: { chatId: 'oc_chat', threadId: 'omt_thread', requesterId: 'ou_admin' },
    })).resolves.toEqual({ kind: 'started', updateId: 'update-1', targetVersion: '0.19.0' });
    expect(start).toHaveBeenCalledWith('0.19.0', {
      chatId: 'oc_chat', threadId: 'omt_thread', requesterId: 'ou_admin',
    });
  });

  it('cancels an offer without starting any update and consumes the card once', async () => {
    const start = vi.fn();
    const controller = new ChannelUpdateController({
      current: '0.18.0', probe: vi.fn().mockResolvedValue('0.19.0'),
      handoff: { start }, id: () => 'offer-cancel',
    });
    await controller.check({ scope: 'chat-a', actorId: 'ou_admin' });
    const input = {
      offerId: 'offer-cancel', scope: 'chat-a', actorId: 'ou_admin', decision: 'cancel' as const,
      route: { chatId: 'oc_chat', requesterId: 'ou_admin' },
    };

    await expect(controller.decide(input)).resolves.toEqual({ kind: 'cancelled' });
    await expect(controller.decide(input)).resolves.toEqual({ kind: 'stale' });
    expect(start).not.toHaveBeenCalled();
  });

  it('fails closed when the guardian worker cannot be launched', async () => {
    const controller = new ChannelUpdateController({
      current: '0.18.0', probe: vi.fn().mockResolvedValue('0.19.0'),
      handoff: { start: vi.fn().mockRejectedValue(new Error('spawn failed')) },
      id: () => 'offer-failed',
    });
    await controller.check({ scope: 'chat-a', actorId: 'ou_admin' });

    await expect(controller.decide({
      offerId: 'offer-failed', scope: 'chat-a', actorId: 'ou_admin', decision: 'confirm',
      route: { chatId: 'oc_chat', requesterId: 'ou_admin' },
    })).resolves.toEqual({ kind: 'failed' });
  });
});
