import { describe, expect, it, vi } from 'vitest';
import { ChannelHealthMonitor } from '../../src/bridge/channel-health.js';
import type { LarkChannel, WSConnectionStatus } from '@larksuite/channel';

function makeChannel(status: WSConnectionStatus | undefined) {
  let current = status;
  const channel = {
    getConnectionStatus: vi.fn(() => current),
  } as unknown as LarkChannel;
  return {
    channel,
    setStatus: (next: WSConnectionStatus | undefined) => {
      current = next;
    },
  };
}

describe('ChannelHealthMonitor (issue #108)', () => {
  it('defaults to connecting / not ready before any connection', () => {
    const { channel } = makeChannel(undefined);
    const monitor = new ChannelHealthMonitor(channel);
    const snap = monitor.snapshot();
    expect(snap.state).toBe('connecting');
    expect(snap.ready).toBe(false);
    expect(snap.generation).toBe(0);
  });

  it('reflects a ready connection from the SDK status on start', () => {
    const { channel } = makeChannel({ state: 'connected', reconnectAttempts: 0 });
    const monitor = new ChannelHealthMonitor(channel, { pollMs: 10_000 });
    monitor.start();
    const snap = monitor.snapshot();
    expect(snap.state).toBe('ready');
    expect(snap.ready).toBe(true);
    monitor.stop();
  });

  it('tracks reconnect generation and connected timestamps', () => {
    const { channel } = makeChannel({ state: 'connected', reconnectAttempts: 0 });
    const monitor = new ChannelHealthMonitor(channel);
    monitor.observeReconnecting();
    expect(monitor.snapshot().state).toBe('reconnecting');
    expect(monitor.snapshot().ready).toBe(false);

    monitor.observeReconnected();
    const snap = monitor.snapshot();
    expect(snap.generation).toBe(1);
    expect(snap.state).toBe('ready');
    expect(snap.ready).toBe(true);
    expect(typeof snap.connectedAt).toBe('number');
    expect(typeof snap.lastReconnectAt).toBe('number');
  });

  it('records the last inbound message time', () => {
    const { channel } = makeChannel({ state: 'connected', reconnectAttempts: 0 });
    const monitor = new ChannelHealthMonitor(channel);
    monitor.observeMessage();
    expect(typeof monitor.snapshot().lastInboundAt).toBe('number');
  });

  it('records the last transport error', () => {
    const { channel } = makeChannel({ state: 'connected', reconnectAttempts: 0 });
    const monitor = new ChannelHealthMonitor(channel);
    monitor.observeError(new Error('pong timeout'));
    const snap = monitor.snapshot();
    expect(snap.lastError).toBe('pong timeout');
  });

  it('notifies onUpdate on observable state changes', () => {
    const { channel } = makeChannel({ state: 'connected', reconnectAttempts: 0 });
    const onUpdate = vi.fn();
    const monitor = new ChannelHealthMonitor(channel, { onUpdate });
    monitor.observeReconnected();
    expect(onUpdate).toHaveBeenCalled();
    const last = onUpdate.mock.calls.at(-1)?.[0] as { generation: number };
    expect(last.generation).toBe(1);
  });
});
