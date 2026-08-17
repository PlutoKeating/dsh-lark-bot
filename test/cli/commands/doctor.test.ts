import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runDoctor } from '../../../src/cli/commands/doctor.js';
import { ConfigStore } from '../../../src/config/profile-store.js';

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.DSH_LARK_HOME;
  delete process.env.DSH_LARK_DSH_COMMAND;
  delete process.env.DSH_LARK_DSH_ARGS;
  delete process.env.DSH_LARK_ADAPTER;
  delete process.env.DSH_LARK_UPGRADE_CHECK;
  delete process.env.DSH_HOME;
  process.exitCode = 0;
});

describe('runDoctor', () => {
  it('reports an existing profile and local dsh availability', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-doctor-'));
    process.env.DSH_LARK_HOME = root;
    process.env.DSH_LARK_DSH_COMMAND = 'node';
    process.env.DSH_LARK_ADAPTER = 'headless';
    process.env.DSH_LARK_UPGRADE_CHECK = '0';
    const store = new ConfigStore(join(root, 'config.json'));
    await store.load();
    await store.saveProfile('default', {
      tenant: 'feishu',
      appId: 'cli_test',
      appSecret: 'secret',
      workspace: join(root, 'workspace'),
    });

    const outputChunks: string[] = [];
    try {
      await runDoctor({ version: 'test', output: (text) => outputChunks.push(text) });
    } finally {
      await rm(root, { recursive: true, force: true });
    }

    const output = outputChunks.join('');
    expect(output).toContain('config: ok');
    expect(output).toContain('app_secret=present');
    expect(output).toContain('dsh: ok');
    expect(process.exitCode ?? 0).toBe(0);
  });

  it('marks missing profiles as a critical diagnostic', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-doctor-empty-'));
    process.env.DSH_LARK_HOME = root;
    process.env.DSH_LARK_DSH_COMMAND = 'node';
    process.env.DSH_LARK_ADAPTER = 'headless';
    process.env.DSH_LARK_UPGRADE_CHECK = '0';
    const outputChunks: string[] = [];

    try {
      await runDoctor({ version: 'test', output: (text) => outputChunks.push(text) });
    } finally {
      await rm(root, { recursive: true, force: true });
    }

    expect(process.exitCode).toBe(1);
  });

  it('reports an update reminder when a newer version is available', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-doctor-upgrade-'));
    process.env.DSH_LARK_HOME = root;
    process.env.DSH_LARK_DSH_COMMAND = 'node';
    process.env.DSH_LARK_ADAPTER = 'headless';
    process.env.DSH_LARK_UPGRADE_CHECK = '1';
    const probe = vi.fn().mockResolvedValue('9.9.9');
    const outputChunks: string[] = [];
    try {
      await runDoctor({
        version: '0.13.1',
        output: (text) => outputChunks.push(text),
        probeLatestFn: probe,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
    const output = outputChunks.join('');
    expect(output).toContain('upgrade: 有新版本 9.9.9（当前 0.13.1）');
    expect(output).toContain('dsh-lark-bot upgrade');
    expect(probe).toHaveBeenCalledWith('dsh-lark-bot');
  });

  it('skips the update reminder when disabled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-doctor-no-upgrade-'));
    process.env.DSH_LARK_HOME = root;
    process.env.DSH_LARK_DSH_COMMAND = 'node';
    process.env.DSH_LARK_ADAPTER = 'headless';
    process.env.DSH_LARK_UPGRADE_CHECK = '0';
    const probe = vi.fn().mockResolvedValue('9.9.9');
    const outputChunks: string[] = [];
    try {
      await runDoctor({
        version: '0.13.1',
        output: (text) => outputChunks.push(text),
        probeLatestFn: probe,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
    expect(outputChunks.join('')).not.toContain('upgrade:');
    expect(probe).not.toHaveBeenCalled();
  });

  it('warns when the guardian unit points into the npm cache', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-doctor-guardian-'));
    process.env.DSH_LARK_HOME = root;
    process.env.DSH_LARK_DSH_COMMAND = 'node';
    process.env.DSH_LARK_ADAPTER = 'headless';
    process.env.DSH_LARK_UPGRADE_CHECK = '0';
    const unitDir = join(root, '.config', 'systemd', 'user');
    await mkdir(unitDir, { recursive: true });
    await writeFile(
      join(unitDir, 'dsh-lark-guardian.service'),
      'ExecStart=/usr/bin/node /home/u/.npm/_npx/abc/node_modules/dsh-lark-bot/dist/cli.js guardian run\n',
      'utf8',
    );
    const outputChunks: string[] = [];
    try {
      await runDoctor({
        version: '0.13.1',
        output: (text) => outputChunks.push(text),
        guardianRoot: root,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
    expect(outputChunks.join('')).toContain('guardian: ⚠️ 服务单元指向 npx 缓存路径');
  });

  it('surfaces a pending restart after an upgrade', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-doctor-restart-'));
    process.env.DSH_LARK_HOME = root;
    process.env.DSH_LARK_DSH_COMMAND = 'node';
    process.env.DSH_LARK_ADAPTER = 'headless';
    process.env.DSH_LARK_UPGRADE_CHECK = '0';
    await writeFile(
      join(root, 'upgrade-state.json'),
      JSON.stringify({
        schemaVersion: 1,
        lastUpgrade: {
          at: '2026-08-17T00:00:00.000Z',
          fromVersion: '0.13.0',
          toVersion: '0.13.1',
          profile: 'dsh-lark',
          packageSpec: 'dsh-lark-bot@0.13.1',
          guardianInstalled: true,
          pendingRestart: true,
        },
      }),
      'utf8',
    );
    const outputChunks: string[] = [];
    try {
      await runDoctor({ version: '0.13.1', output: (text) => outputChunks.push(text) });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
    expect(outputChunks.join('')).toContain('upgrade: ⚠️ 上次升级待重启生效');
  });

  it('warns when a runtime profile link version drifts from the installed package', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-doctor-runtime-'));
    process.env.DSH_LARK_HOME = root;
    process.env.DSH_HOME = join(root, '.dsh');
    process.env.DSH_LARK_DSH_COMMAND = 'node';
    process.env.DSH_LARK_ADAPTER = 'headless';
    process.env.DSH_LARK_UPGRADE_CHECK = '0';
    const dshHome = join(root, '.dsh');
    await mkdir(
      join(dshHome, 'profiles', 'dsh-lark', 'node_modules', 'dsh-lark-bot'),
      { recursive: true },
    );
    await writeFile(
      join(dshHome, 'profiles', 'dsh-lark', 'node_modules', 'dsh-lark-bot', 'package.json'),
      JSON.stringify({ name: 'dsh-lark-bot', version: '0.13.1' }),
      'utf8',
    );
    await mkdir(
      join(dshHome, 'profiles', 'dsh-lark-sdk', 'node_modules', 'dsh-lark-bot'),
      { recursive: true },
    );
    await writeFile(
      join(dshHome, 'profiles', 'dsh-lark-sdk', 'node_modules', 'dsh-lark-bot', 'package.json'),
      JSON.stringify({ name: 'dsh-lark-bot', version: '0.13.0' }),
      'utf8',
    );
    const outputChunks: string[] = [];
    try {
      await runDoctor({ version: '0.13.1', output: (text) => outputChunks.push(text) });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
    expect(outputChunks.join('')).toContain(
      'runtime dsh-lark-sdk: ⚠️ 链接版本 0.13.0 与已装 0.13.1 不一致',
    );
  });
});
