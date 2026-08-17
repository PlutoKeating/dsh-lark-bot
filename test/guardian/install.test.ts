import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadRuntimeEnv } from '../../src/config/env.js';
import {
  installGuardian,
  launchdPlist,
  readGuardianUnit,
  resolveGuardianCliEntry,
  systemdUnit,
  windowsStartupCmd,
} from '../../src/guardian/install.js';
import { loadGuardianState, newGuardianState } from '../../src/guardian/state.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('guardian service units', () => {
  it('renders a systemd user unit', () => {
    const unit = systemdUnit('/usr/bin/node', '/home/u/dsh-lark-bot/dist/cli.js', {
      DSH_LARK_GUARDIAN_DISABLED: '0',
    });
    expect(unit).toContain('ExecStart=/usr/bin/node /home/u/dsh-lark-bot/dist/cli.js guardian run');
    expect(unit).toContain('Restart=on-failure');
    expect(unit).toContain('WantedBy=default.target');
  });

  it('renders a launchd plist and a Windows startup script', () => {
    const plist = launchdPlist('/usr/local/bin/node', '/app/dist/cli.js');
    expect(plist).toContain('<key>Label</key><string>io.dsh-lark.dsh-lark-guardian</string>');
    expect(plist).toContain('<string>guardian</string>');
    expect(plist).toContain('<key>KeepAlive</key><true/>');

    const cmd = windowsStartupCmd('node.exe', 'C:\\app\\dist\\cli.js');
    expect(cmd).toContain('start "" /b "node.exe" "C:\\app\\dist\\cli.js" guardian run');
  });

  it('persists the profile mapping without touching the service manager (dry run)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-install-dry-'));
    tempDirs.push(dir);
    const env = loadRuntimeEnv({ DSH_LARK_HOME: dir });
    const result = await installGuardian({
      env,
      dshProfile: 'dsh-lark',
      bridgeProfile: 'default',
      rootOverride: dir,
      dryRun: true,
    });
    expect(result.ok).toBe(true);
    const state = await loadGuardianState(
      join(dir, '.dsh-lark', 'guardian.json'),
      newGuardianState({}),
    );
    expect(state.dshProfile).toBe('dsh-lark');
    expect(state.safeProfile).toBe('dsh-lark-safe');
  });

  it('prefers the profile-installed package for the service CLI entry', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-install-entry-'));
    tempDirs.push(dir);
    const dshHome = join(dir, '.dsh');
    const cliPath = join(
      dshHome,
      'profiles',
      'dsh-lark',
      'node_modules',
      'dsh-lark-bot',
      'dist',
      'cli.js',
    );
    process.env.DSH_HOME = dshHome;
    try {
      await mkdir(join(cliPath, '..'), { recursive: true });
      await writeFile(cliPath, '// placeholder\n', 'utf8');
      expect(resolveGuardianCliEntry('dsh-lark', dir)).toBe(cliPath);

      // Without a profile package the running package is used as fallback.
      const other = await mkdtemp(join(tmpdir(), 'dsh-install-entry-empty-'));
      tempDirs.push(other);
      process.env.DSH_HOME = join(other, '.dsh');
      expect(resolveGuardianCliEntry('dsh-lark', other)).toContain('dist/cli.js');
    } finally {
      delete process.env.DSH_HOME;
    }
  });

  it('writes and removes the systemd unit on Linux', async () => {
    if (process.platform !== 'linux') return;
    const dir = await mkdtemp(join(tmpdir(), 'dsh-install-linux-'));
    tempDirs.push(dir);
    const env = loadRuntimeEnv({ DSH_LARK_HOME: dir });
    const run = vi.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' });
    const result = await installGuardian({
      env,
      dshProfile: 'demo',
      rootOverride: dir,
      run,
    });
    expect(result.ok).toBe(true);
    const unit = await readGuardianUnit('linux', dir);
    expect(unit).toContain('guardian run');
    expect(run).toHaveBeenCalledWith('systemctl', expect.arrayContaining(['--user', 'enable']));
    const { uninstallGuardian } = await import('../../src/guardian/install.js');
    const removed = await uninstallGuardian({ env, rootOverride: dir, run });
    expect(removed.ok).toBe(true);
    expect(await readGuardianUnit('linux', dir)).toBeUndefined();
  });
});
