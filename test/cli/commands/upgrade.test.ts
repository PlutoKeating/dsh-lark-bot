import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runUpgrade } from '../../../src/cli/commands/upgrade.js';
import { loadUpgradeState } from '../../../src/upgrade/state.js';
import { guardianServiceFilePath } from '../../../src/guardian/install.js';

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-upgrade-'));
  tempDirs.push(home);
  return home;
}

/** Install a fake package manifest into the profile's node_modules. */
async function installFakePackage(home: string, profile: string, version: string): Promise<void> {
  const manifest = join(home, 'profiles', profile, 'node_modules', 'dsh-lark-bot', 'package.json');
  await mkdir(join(manifest, '..'), { recursive: true });
  await writeFile(manifest, JSON.stringify({ name: 'dsh-lark-bot', version }), 'utf8');
}

interface Harness {
  out: string[];
  dshHome: string;
  larkHome: string;
  guardianRoot: string;
  stateFile: string;
  pluginSpawn: ReturnType<typeof vi.fn>;
  installGuardian: ReturnType<typeof vi.fn>;
  restartGuardian: ReturnType<typeof vi.fn>;
  restartProfile: ReturnType<typeof vi.fn>;
  repairRuntime: ReturnType<typeof vi.fn>;
  runDoctor: ReturnType<typeof vi.fn>;
}

function makeHarness(): Harness {
  const out: string[] = [];
  const pluginSpawn = vi.fn().mockResolvedValue(undefined);
  const installGuardian = vi.fn().mockResolvedValue({
    ok: true,
    messages: ['守护状态已写入 /tmp/guardian.json'],
  });
  const restartGuardian = vi.fn().mockResolvedValue({ ok: true, message: 'guardian 已重启' });
  const restartProfile = vi.fn().mockResolvedValue({ ok: true, message: 'profile 已重启' });
  const repairRuntime = vi.fn().mockResolvedValue([
    { profile: 'dsh-lark-sdk', existed: true, repaired: true, ok: true },
    { profile: 'dsh-lark-acp', existed: false, repaired: false, ok: true },
  ]);
  const runDoctor = vi.fn().mockResolvedValue({
    lines: ['dsh-lark-bot doctor', 'version: 0.11.0', 'config: missing'],
    critical: false,
  });
  return {
    out,
    dshHome: '',
    larkHome: '',
    guardianRoot: '',
    stateFile: '',
    pluginSpawn,
    installGuardian,
    restartGuardian,
    restartProfile,
    repairRuntime,
    runDoctor,
  };
}

async function runWith(
  harness: Harness,
  options: Parameters<typeof runUpgrade>[0] = {},
): Promise<void> {
  await runUpgrade({
    dshHome: harness.dshHome,
    larkHome: harness.larkHome,
    ...(harness.guardianRoot ? { guardianRoot: harness.guardianRoot } : {}),
    stateFile: harness.stateFile,
    dshBin: '/fake/dsh/bin.js',
    output: (text) => harness.out.push(text),
    pluginSpawnFn: harness.pluginSpawn,
    installGuardianFn: harness.installGuardian,
    restartGuardianFn: harness.restartGuardian,
    restartProfileFn: harness.restartProfile,
    repairRuntimeFn: harness.repairRuntime,
    runDoctorFn: harness.runDoctor,
    listProcessesFn: async () => [],
    ...options,
  });
}

/** Create a fake guardian service entry so detection reports it installed. */
async function installFakeGuardian(root: string): Promise<void> {
  const file = guardianServiceFilePath(process.platform, root);
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, '# fake guardian unit', 'utf8');
}

describe('dsh-lark-bot upgrade', () => {
  it('--check reports versions and running state without changing anything', async () => {
    const harness = makeHarness();
    harness.dshHome = await makeHome();
    harness.larkHome = await makeHome();
    harness.stateFile = join(harness.larkHome, 'upgrade-state.json');
    await installFakePackage(harness.dshHome, 'dsh-lark', '0.10.2');

    await runWith(harness, {
      check: true,
      fetchLatestFn: async () => '0.11.0',
    });

    const joined = harness.out.join('');
    expect(joined).toContain('已安装（profile dsh-lark）: 0.10.2');
    expect(joined).toContain('npm 最新: 0.11.0');
    expect(harness.pluginSpawn).not.toHaveBeenCalled();
    expect(harness.installGuardian).not.toHaveBeenCalled();
    expect(harness.runDoctor).toHaveBeenCalled();
  });

  it('upgrades package + guardian and records the change for rollback', async () => {
    const harness = makeHarness();
    harness.dshHome = await makeHome();
    harness.larkHome = await makeHome();
    harness.stateFile = join(harness.larkHome, 'upgrade-state.json');
    await installFakePackage(harness.dshHome, 'dsh-lark', '0.10.2');

    await runWith(harness, {
      yes: true,
      fetchLatestFn: async () => '0.12.0',
    });

    expect(harness.pluginSpawn).toHaveBeenCalledWith(
      '/fake/dsh/bin.js',
      'dsh-lark',
      'dsh-lark-bot@0.12.0',
    );
    expect(harness.installGuardian).toHaveBeenCalledWith(
      expect.objectContaining({ dshProfile: 'dsh-lark' }),
    );
    expect(harness.repairRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ dshHome: harness.dshHome }),
    );
    const joined = harness.out.join('');
    expect(joined).toContain('✅ 包本体已更新到 0.12.0');
    expect(joined).toContain('runtime profile dsh-lark-sdk: own-package 链接已修复');
    expect(joined).toContain('回滚命令：dsh-lark-bot upgrade --rollback');

    const state = await loadUpgradeState(harness.stateFile);
    expect(state?.lastUpgrade).toMatchObject({
      fromVersion: '0.10.2',
      toVersion: '0.12.0',
      profile: 'dsh-lark',
      packageSpec: 'dsh-lark-bot@0.12.0',
      guardianInstalled: true,
    });
  });

  it('reports up-to-date without touching anything', async () => {
    const harness = makeHarness();
    harness.dshHome = await makeHome();
    harness.larkHome = await makeHome();
    harness.guardianRoot = await makeHome();
    harness.stateFile = join(harness.larkHome, 'upgrade-state.json');
    await installFakePackage(harness.dshHome, 'dsh-lark', '0.11.0');
    await installFakeGuardian(harness.guardianRoot);

    await runWith(harness, {
      yes: true,
      fetchLatestFn: async () => '0.11.0',
    });

    expect(harness.out.join('')).toContain('已是最新');
    expect(harness.pluginSpawn).not.toHaveBeenCalled();
    expect(harness.installGuardian).not.toHaveBeenCalled();
    expect(harness.repairRuntime).not.toHaveBeenCalled();
  });

  it('aborts without --yes when confirmation is declined', async () => {
    const harness = makeHarness();
    harness.dshHome = await makeHome();
    harness.larkHome = await makeHome();
    harness.stateFile = join(harness.larkHome, 'upgrade-state.json');
    await installFakePackage(harness.dshHome, 'dsh-lark', '0.10.2');

    await runWith(harness, {
      confirmFn: async () => false,
      fetchLatestFn: async () => '0.12.0',
    });

    expect(harness.out.join('')).toContain('已取消');
    expect(harness.pluginSpawn).not.toHaveBeenCalled();
    expect(harness.installGuardian).not.toHaveBeenCalled();
  });

  it('aborts when npm latest is unreachable without --force', async () => {
    const harness = makeHarness();
    harness.dshHome = await makeHome();
    harness.larkHome = await makeHome();
    harness.stateFile = join(harness.larkHome, 'upgrade-state.json');
    await installFakePackage(harness.dshHome, 'dsh-lark', '0.10.2');

    await runWith(harness, { yes: true, fetchLatestFn: async () => undefined });

    expect(harness.out.join('')).toContain('无法获取 npm 最新版本');
    expect(harness.pluginSpawn).not.toHaveBeenCalled();
  });

  it('--force proceeds with the running package version when offline', async () => {
    const harness = makeHarness();
    harness.dshHome = await makeHome();
    harness.larkHome = await makeHome();
    harness.stateFile = join(harness.larkHome, 'upgrade-state.json');
    await installFakePackage(harness.dshHome, 'dsh-lark', '0.10.2');

    await runWith(harness, {
      yes: true,
      force: true,
      fetchLatestFn: async () => undefined,
    });

    // own.version is the repo's package.json version (0.11.0 in tests).
    const spec = harness.pluginSpawn.mock.calls[0]?.[2];
    expect(spec).toMatch(/^dsh-lark-bot@/);
    expect(harness.installGuardian).toHaveBeenCalled();
  });

  it('--rollback reinstalls the previously recorded version', async () => {
    const harness = makeHarness();
    harness.dshHome = await makeHome();
    harness.larkHome = await makeHome();
    harness.stateFile = join(harness.larkHome, 'upgrade-state.json');
    await installFakePackage(harness.dshHome, 'dsh-lark', '0.11.0');
    await writeFile(
      harness.stateFile,
      JSON.stringify({
        schemaVersion: 1,
        lastUpgrade: {
          at: '2026-08-15T23:00:00.000Z',
          fromVersion: '0.10.2',
          toVersion: '0.11.0',
          profile: 'dsh-lark',
          packageSpec: 'dsh-lark-bot@0.11.0',
          guardianInstalled: true,
        },
      }),
      'utf8',
    );

    await runWith(harness, { yes: true, rollback: true });

    expect(harness.pluginSpawn).toHaveBeenCalledWith(
      '/fake/dsh/bin.js',
      'dsh-lark',
      'dsh-lark-bot@0.10.2',
    );
    const state = await loadUpgradeState(harness.stateFile);
    expect(state?.lastUpgrade.toVersion).toBe('0.10.2');
  });

  it('warns when the profile process is running and --restart is not given', async () => {
    const harness = makeHarness();
    harness.dshHome = await makeHome();
    harness.larkHome = await makeHome();
    harness.stateFile = join(harness.larkHome, 'upgrade-state.json');
    await installFakePackage(harness.dshHome, 'dsh-lark', '0.10.2');

    await runWith(harness, {
      yes: true,
      fetchLatestFn: async () => '0.12.0',
      listProcessesFn: async () => [
        {
          pid: 4242,
          cmdline: 'node /home/x/@deepseek-ai/dsh/lib/bin.js --profile dsh-lark',
        },
      ],
    });

    expect(harness.out.join('')).toContain('dsh profile 进程正在运行（pid 4242）');
    expect(harness.restartProfile).not.toHaveBeenCalled();
  });

  it('--restart triggers the guardian and profile restart helpers', async () => {
    const harness = makeHarness();
    harness.dshHome = await makeHome();
    harness.larkHome = await makeHome();
    harness.stateFile = join(harness.larkHome, 'upgrade-state.json');
    await installFakePackage(harness.dshHome, 'dsh-lark', '0.10.2');

    await runWith(harness, {
      yes: true,
      restart: true,
      fetchLatestFn: async () => '0.12.0',
      listProcessesFn: async () => [
        {
          pid: 4242,
          cmdline: 'node /home/x/@deepseek-ai/dsh/lib/bin.js --profile dsh-lark',
        },
      ],
    });

    expect(harness.restartGuardian).toHaveBeenCalled();
    expect(harness.restartProfile).toHaveBeenCalled();
  });

  it('--no-guardian skips the guardian install', async () => {
    const harness = makeHarness();
    harness.dshHome = await makeHome();
    harness.larkHome = await makeHome();
    harness.stateFile = join(harness.larkHome, 'upgrade-state.json');
    await installFakePackage(harness.dshHome, 'dsh-lark', '0.10.2');

    await runWith(harness, {
      yes: true,
      guardian: false,
      fetchLatestFn: async () => '0.12.0',
    });

    expect(harness.pluginSpawn).toHaveBeenCalled();
    expect(harness.installGuardian).not.toHaveBeenCalled();
    expect(harness.out.join('')).toContain('已跳过 guardian（--no-guardian）');
  });
});
