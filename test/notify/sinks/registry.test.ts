import { describe, expect, it } from 'vitest';
import { OutboundSinkRegistry } from '../../../src/notify/sinks/registry.js';
import type { NotificationChannelStore } from '../../../src/notify/sinks/channel-store.js';
import type { OutboundSink, SinkChannel, SinkMessage } from '../../../src/notify/sinks/types.js';

const channels: SinkChannel[] = [
  { id: 'tg-main', type: 'telegram', label: 'Ops', destination: '@ops', secret: 't', enabled: true },
  { id: 'wecom-main', type: 'wecom', label: '群', destination: 'k', secret: 'k', enabled: true },
  { id: 'tg-disabled', type: 'telegram', label: 'Off', destination: '@x', secret: 'x', enabled: false },
];

function store(): NotificationChannelStore {
  return { list: () => channels } as unknown as NotificationChannelStore;
}

const message: SinkMessage = { scope: 'chat-a', event: 'completed', title: { zh: '✅', en: '✅' } };

describe('OutboundSinkRegistry', () => {
  it('fans out only to requested, enabled, configured channels with matching sinks', async () => {
    const sent: Record<string, boolean> = {};
    const sinks: OutboundSink[] = [
      { type: 'telegram', send: async (c) => { sent[c.id] = true; return true; } },
      { type: 'wecom', send: async (c) => { sent[c.id] = true; return true; } },
    ];
    const registry = new OutboundSinkRegistry(store(), sinks);
    const outcome = await registry.broadcast(['tg-main', 'tg-disabled', 'wecom-main', 'tg-main'], message);
    expect(outcome.delivered).toBe(2);
    expect(outcome.failures).toEqual([]);
    expect(sent).toEqual({ 'tg-main': true, 'wecom-main': true });
  });

  it('collects failures when a sink rejects and skips unknown types', async () => {
    const sinks: OutboundSink[] = [
      { type: 'telegram', send: async () => false },
      { type: 'wecom', send: async () => { throw new Error('boom'); } },
    ];
    const registry = new OutboundSinkRegistry(store(), sinks);
    const outcome = await registry.broadcast(['tg-main', 'wecom-main'], message);
    expect(outcome.delivered).toBe(0);
    expect(outcome.failures.sort()).toEqual(['tg-main', 'wecom-main']);
  });

  it('reports enabled channels for /status', () => {
    const registry = new OutboundSinkRegistry(store(), []);
    expect(registry.enabledChannels().map((c) => c.id)).toEqual(['tg-main', 'wecom-main']);
  });
});
