import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatServiceStatus, runServiceCommand } from '../../../src/cli/commands/service.js';
import type { ServiceManager } from '../../../src/service/manager.js';
import type { ServiceStatus } from '../../../src/service/types.js';

const RUNNING: ServiceStatus = {
  name: 'dsh-lark-engine-dsh-lark',
  platform: 'linux-systemd',
  installed: true,
  autostartEnabled: true,
  state: 'running',
  detail: 'active',
  pid: 42,
  restarts: 1,
};

afterEach(() => {
  process.exitCode = undefined;
});

describe('service CLI', () => {
  it('prints lifecycle status with the bridge heartbeat age', async () => {
    const output = vi.fn();
    const manager = { status: vi.fn().mockResolvedValue(RUNNING) } as unknown as ServiceManager;
    await runServiceCommand('status', {}, {
      manager,
      output,
      heartbeatAge: async () => 1_250,
    });
    expect(output).toHaveBeenCalledWith(expect.stringContaining('heartbeat: 1250ms'));
    expect(process.exitCode).toBeUndefined();
  });

  it('delegates stop and reports failures without throwing', async () => {
    const output = vi.fn();
    const manager = { stop: vi.fn().mockRejectedValue(new Error('stop failed')) } as unknown as ServiceManager;
    await runServiceCommand('stop', {}, { manager, output, heartbeatAge: async () => undefined });
    expect(output).toHaveBeenCalledWith('stop failed\n');
    expect(process.exitCode).toBe(1);
  });

  it('reads and follows the service log path', async () => {
    const output = vi.fn();
    const followLog = vi.fn().mockResolvedValue(undefined);
    const manager = {
      logs: vi.fn().mockResolvedValue({ path: '/tmp/service.log', text: 'tail' }),
    } as unknown as ServiceManager;
    await runServiceCommand('logs', { lines: 12, follow: true }, { manager, output, followLog });
    expect(manager.logs).toHaveBeenCalledWith(12);
    expect(followLog).toHaveBeenCalledWith('/tmp/service.log', 12);
  });
});

describe('formatServiceStatus', () => {
  it('renders platform, pid and restart counters', () => {
    const text = formatServiceStatus(RUNNING, undefined);
    expect(text).toContain('platform:  linux-systemd');
    expect(text).toContain('pid:       42');
    expect(text).toContain('restarts:  1');
  });
});
