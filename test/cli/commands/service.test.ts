import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  printServiceStatus,
  runServiceCommand,
} from '../../../src/cli/commands/service.js';
import { ServiceManager } from '../../../src/service/manager.js';
import type { ServiceStatus } from '../../../src/service/types.js';

const RUNNING: ServiceStatus = {
  name: 'dsh-lark-bot',
  platform: 'linux-systemd',
  installed: true,
  autostartEnabled: true,
  state: 'running',
  detail: 'active',
  pid: 42,
  restarts: 0,
};

const STOPPED: ServiceStatus = {
  name: 'dsh-lark-bot',
  platform: 'linux-systemd',
  installed: true,
  autostartEnabled: false,
  state: 'stopped',
  detail: 'inactive',
  pid: undefined,
  restarts: undefined,
};

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
});

describe('runServiceCommand', () => {
  it('status exits 0 for a running service and prints details', async () => {
    const manager = {
      status: vi.fn().mockResolvedValue(RUNNING),
    } as unknown as ServiceManager;
    const outputChunks: string[] = [];
    await runServiceCommand('status', {}, { manager, output: (text) => outputChunks.push(text) });

    const output = outputChunks.join('');
    expect(output).toContain('dsh-lark-bot 服务状态');
    expect(output).toContain('state:     running');
    expect(output).toContain('pid:       42');
    expect(process.exitCode ?? 0).toBe(0);
  });

  it('status exits 1 when the service is stopped', async () => {
    const manager = {
      status: vi.fn().mockResolvedValue(STOPPED),
    } as unknown as ServiceManager;
    await runServiceCommand('status', {}, { manager, output: () => undefined });
    expect(process.exitCode).toBe(1);
  });

  it('restart delegates and exits 1 on failure', async () => {
    const manager = {
      restart: vi.fn().mockRejectedValue(new Error('后台服务尚未安装，请先运行 dsh-lark-bot start')),
    } as unknown as ServiceManager;
    const outputChunks: string[] = [];
    await runServiceCommand('restart', {}, { manager, output: (text) => outputChunks.push(text) });

    expect(outputChunks.join('')).toContain('请先运行 dsh-lark-bot start');
    expect(process.exitCode).toBe(1);
  });

  it('stop exits 0 once the service is stopped', async () => {
    const manager = {
      stop: vi.fn().mockResolvedValue(STOPPED),
    } as unknown as ServiceManager;
    await runServiceCommand('stop', {}, { manager, output: () => undefined });
    expect(process.exitCode ?? 0).toBe(0);
  });
});

describe('printServiceStatus', () => {
  it('renders every status field', () => {
    const chunks: string[] = [];
    printServiceStatus(RUNNING, (text) => chunks.push(text));
    const output = chunks.join('');
    expect(output).toContain('name:      dsh-lark-bot');
    expect(output).toContain('platform:  linux-systemd');
    expect(output).toContain('installed: 是');
    expect(output).toContain('autostart: 已启用（开机自启）');
    expect(output).toContain('restarts:  0');
  });
});
