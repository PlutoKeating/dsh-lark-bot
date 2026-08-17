import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetUpdateCheckCache } from '../../src/upgrade/update-check.js';
import { UpdateNotifier } from '../../src/upgrade/update-notifier.js';

afterEach(() => {
  vi.restoreAllMocks();
  resetUpdateCheckCache();
});

describe('UpdateNotifier', () => {
  it('notifies once per version when enabled', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const log = { warn: vi.fn() };
    const notifier = new UpdateNotifier({
      current: '0.13.1',
      notify: true,
      notifyChat: 'oc_notify',
      intervalMs: 0,
      probe: async () => '0.14.0',
      send,
      log,
    });
    const first = await notifier.checkNow();
    expect(first).toEqual({ latest: '0.14.0', notified: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toBe('oc_notify');
    expect(String(send.mock.calls[0]?.[1])).toContain('0.14.0');
    expect(log.warn).toHaveBeenCalledWith(
      'upgrade',
      'update-available',
      expect.anything(),
    );

    const second = await notifier.checkNow();
    expect(second.notified).toBe(false);
    expect(send).toHaveBeenCalledTimes(1); // deduped per version
  });

  it('logs but does not push when notify is disabled', async () => {
    const send = vi.fn();
    const log = { warn: vi.fn() };
    const notifier = new UpdateNotifier({
      current: '0.13.1',
      notify: false,
      intervalMs: 0,
      probe: async () => '0.14.0',
      send,
      log,
    });
    const outcome = await notifier.checkNow();
    expect(outcome.latest).toBe('0.14.0');
    expect(send).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalled();
  });

  it('does nothing on probe failure or when already latest', async () => {
    const send = vi.fn();
    const log = { warn: vi.fn() };
    const failed = new UpdateNotifier({
      current: '0.13.1',
      notify: true,
      notifyChat: 'oc_notify',
      intervalMs: 0,
      probe: async () => undefined,
      send,
      log,
    });
    await expect(failed.checkNow()).resolves.toEqual({
      latest: undefined,
      notified: false,
    });
    expect(send).not.toHaveBeenCalled();

    const current = new UpdateNotifier({
      current: '0.13.1',
      notify: true,
      notifyChat: 'oc_notify',
      intervalMs: 0,
      probe: async () => '0.13.1',
      send,
      log,
    });
    await expect(current.checkNow()).resolves.toEqual({
      latest: '0.13.1',
      notified: false,
    });
    expect(send).not.toHaveBeenCalled();
  });
});
