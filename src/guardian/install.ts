import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ownPackageInfo } from '../adapters/dsh/own-package.js';
import type { RuntimeEnv } from '../config/env.js';
import { captureOutput } from './process.js';
import {
  loadGuardianState,
  newGuardianState,
  saveGuardianState,
  type GuardianState,
} from './state.js';

/**
 * System-level installation of the safety-net guardian.
 *
 * The guardian is a minimal Node process that must survive dsh / Cordis
 * going down, so it is registered with the operating system's user-level
 * service manager (systemd user unit on Linux, launchd LaunchAgent on macOS,
 * Startup entry on Windows). The unit only runs `dsh-lark-bot guardian run`;
 * all dsh knowledge lives in `~/.dsh-lark/guardian.json`.
 */

export const GUARDIAN_LABEL = 'dsh-lark-guardian';

export interface InstallGuardianOptions {
  env: RuntimeEnv;
  dshProfile?: string;
  bridgeProfile?: string;
  /** Skip writing service files; only persist the state mapping (tests). */
  dryRun?: boolean;
  /** Injectable command runner for activation (tests). */
  run?: (command: string, args: readonly string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
  rootOverride?: string;
  userOverride?: string;
}

export interface InstallResult {
  ok: boolean;
  messages: string[];
}

function guardianCliEntry(): string {
  return join(ownPackageInfo().root, 'dist', 'cli.js');
}

function serviceDirectory(platform: NodeJS.Platform, root: string): string {
  switch (platform) {
    case 'linux':
      return join(root, '.config', 'systemd', 'user');
    case 'darwin':
      return join(root, 'Library', 'LaunchAgents');
    case 'win32':
      return join(
        process.env.APPDATA ?? join(root, 'AppData', 'Roaming'),
        'Microsoft',
        'Windows',
        'Start Menu',
        'Programs',
        'Startup',
      );
    default:
      return join(root, '.dsh-lark', 'guardian');
  }
}

/**
 * The exact service-entry file for the current platform (systemd unit,
 * launchd plist, Windows startup .cmd or fallback shell script). Used both by
 * install/uninstall and by the upgrade command to detect whether the guardian
 * is installed.
 */
export function guardianServiceFilePath(
  platform: NodeJS.Platform,
  root: string,
): string {
  const directory = serviceDirectory(platform, root);
  switch (platform) {
    case 'linux':
      return join(directory, `${GUARDIAN_LABEL}.service`);
    case 'darwin':
      return join(directory, `io.dsh-lark.${GUARDIAN_LABEL}.plist`);
    case 'win32':
      return join(directory, `${GUARDIAN_LABEL}.cmd`);
    default:
      return join(directory, `${GUARDIAN_LABEL}.sh`);
  }
}

export function systemdUnit(
  nodeBin: string,
  cliEntry: string,
  env: Record<string, string> = {},
): string {
  const envLines = Object.entries(env)
    .map(([key, value]) => `Environment=${key}=${value}`)
    .join('\n');
  return [
    '[Unit]',
    'Description=dsh-lark-bot safety-net guardian (Feishu rescue when dsh is down)',
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${nodeBin} ${cliEntry} guardian run`,
    'Restart=on-failure',
    'RestartSec=5',
    ...(envLines ? [envLines] : []),
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
}

export function launchdPlist(
  nodeBin: string,
  cliEntry: string,
  label: string = `io.dsh-lark.${GUARDIAN_LABEL}`,
  logPath: string = '/tmp/dsh-lark-guardian.log',
): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    `  <key>Label</key><string>${label}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    `    <string>${nodeBin}</string>`,
    `    <string>${cliEntry}</string>`,
    '    <string>guardian</string>',
    '    <string>run</string>',
    '  </array>',
    '  <key>RunAtLoad</key><true/>',
    '  <key>KeepAlive</key><true/>',
    `  <key>StandardOutPath</key><string>${logPath}</string>`,
    `  <key>StandardErrorPath</key><string>${logPath}</string>`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

export function windowsStartupCmd(
  nodeBin: string,
  cliEntry: string,
): string {
  return [
    '@echo off',
    'REM dsh-lark-bot safety-net guardian - keep the Feishu rescue entrance alive.',
    `start "" /b "${nodeBin}" "${cliEntry}" guardian run`,
    '',
  ].join('\r\n');
}

function defaultRun(
  command: string,
  args: readonly string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return captureOutput(command, args, 30_000);
}

export async function installGuardian(
  options: InstallGuardianOptions,
): Promise<InstallResult> {
  const messages: string[] = [];
  const root = options.rootOverride ?? homedir();
  const dshProfile = options.dshProfile ?? options.env.guardianProfile;
  const bridgeProfile = options.bridgeProfile ?? options.env.guardianBridgeProfile;
  const stateFile = join(root, '.dsh-lark', 'guardian.json');
  const fallback = newGuardianState({ dshProfile, bridgeProfile });
  const existing = await loadGuardianState(stateFile, fallback);
  const state: GuardianState = {
    ...existing,
    dshProfile: existing.dshProfile === dshProfile ? existing.dshProfile : dshProfile,
    bridgeProfile:
      existing.bridgeProfile === bridgeProfile ? existing.bridgeProfile : bridgeProfile,
    safeProfile: existing.safeProfile || `${dshProfile}-safe`,
  };
  await saveGuardianState(stateFile, state);
  messages.push(`守护状态已写入 ${stateFile}（dsh profile=${state.dshProfile}）`);

  if (options.dryRun) {
    return { ok: true, messages };
  }

  const nodeBin = process.execPath;
  const cliEntry = guardianCliEntry();
  const directory = serviceDirectory(process.platform, root);
  await mkdir(directory, { recursive: true });

  if (process.platform === 'linux') {
    const unitPath = guardianServiceFilePath(process.platform, root);
    await writeFile(
      unitPath,
      systemdUnit(nodeBin, cliEntry, { DSH_LARK_GUARDIAN_DISABLED: '0' }),
      'utf8',
    );
    messages.push(`systemd user unit 已写入 ${unitPath}`);
    const run = options.run ?? defaultRun;
    const reload = await run('systemctl', ['--user', 'daemon-reload']);
    const enable = await run('systemctl', ['--user', 'enable', '--now', `${GUARDIAN_LABEL}.service`]);
    if (reload.code === 0 && enable.code === 0) {
      messages.push('守护服务已启用并启动（systemctl --user）。');
    } else {
      messages.push(
        '未能自动启用服务（可能需要图形会话 / systemd user 实例）。请手动执行：',
      );
      messages.push(`  systemctl --user daemon-reload && systemctl --user enable --now ${GUARDIAN_LABEL}.service`);
      return { ok: false, messages };
    }
  } else if (process.platform === 'darwin') {
    const plistPath = guardianServiceFilePath(process.platform, root);
    await writeFile(plistPath, launchdPlist(nodeBin, cliEntry), 'utf8');
    messages.push(`launchd LaunchAgent 已写入 ${plistPath}`);
    const run = options.run ?? defaultRun;
    const uid = typeof options.userOverride === 'string' ? options.userOverride : String(process.getuid?.() ?? 501);
    const bootstrap = await run('launchctl', ['bootstrap', `gui/${uid}`, plistPath]);
    if (bootstrap.code === 0) {
      messages.push('守护服务已加载（launchctl bootstrap）。');
    } else {
      messages.push(
        '未能自动加载 LaunchAgent。请手动执行（或改用旧版 launchctl load -w）：',
      );
      messages.push(`  launchctl bootstrap gui/${uid} ${plistPath}`);
      return { ok: false, messages };
    }
  } else if (process.platform === 'win32') {
    const cmdPath = guardianServiceFilePath(process.platform, root);
    await writeFile(cmdPath, windowsStartupCmd(nodeBin, cliEntry), 'utf8');
    messages.push(`Windows 启动项已写入 ${cmdPath}（登录后自动常驻）。`);
  } else {
    const fallbackPath = guardianServiceFilePath(process.platform, root);
    await writeFile(
      fallbackPath,
      `#!/bin/sh\nexec "${nodeBin}" "${cliEntry}" guardian run\n`,
      'utf8',
    );
    messages.push(
      `当前平台不支持自动注册服务；已写入启动脚本 ${fallbackPath}，请按需配置常驻。`,
    );
  }

  return { ok: true, messages };
}

export async function uninstallGuardian(
  options: Pick<InstallGuardianOptions, 'env' | 'run' | 'rootOverride' | 'userOverride'>,
): Promise<InstallResult> {
  const messages: string[] = [];
  const root = options.rootOverride ?? homedir();
  const run = options.run ?? defaultRun;

  if (process.platform === 'linux') {
    await run('systemctl', ['--user', 'disable', '--now', `${GUARDIAN_LABEL}.service`]);
    const unitPath = join(root, '.config', 'systemd', 'user', `${GUARDIAN_LABEL}.service`);
    await rm(unitPath, { force: true });
    await run('systemctl', ['--user', 'daemon-reload']);
    messages.push('systemd user unit 已移除并停止。');
  } else if (process.platform === 'darwin') {
    const label = `io.dsh-lark.${GUARDIAN_LABEL}`;
    const plistPath = join(root, 'Library', 'LaunchAgents', `${label}.plist`);
    const uid = typeof options.userOverride === 'string' ? options.userOverride : String(process.getuid?.() ?? 501);
    await run('launchctl', ['bootout', `gui/${uid}`, plistPath]);
    await rm(plistPath, { force: true });
    messages.push('launchd LaunchAgent 已移除。');
  } else if (process.platform === 'win32') {
    const startupDir = join(
      process.env.APPDATA ?? join(root, 'AppData', 'Roaming'),
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs',
      'Startup',
    );
    await rm(join(startupDir, `${GUARDIAN_LABEL}.cmd`), { force: true });
    messages.push('Windows 启动项已移除。');
  } else {
    const fallbackPath = join(root, '.dsh-lark', 'guardian', `${GUARDIAN_LABEL}.sh`);
    await rm(fallbackPath, { force: true });
    messages.push('启动脚本已移除。');
  }

  messages.push('守护状态文件（~/.dsh-lark/guardian.json）已保留，可随时重新安装。');
  return { ok: true, messages };
}

export async function readGuardianUnit(platform: NodeJS.Platform, root: string): Promise<string | undefined> {
  if (platform === 'linux') {
    const path = join(root, '.config', 'systemd', 'user', `${GUARDIAN_LABEL}.service`);
    return existsSync(path) ? readFile(path, 'utf8') : undefined;
  }
  if (platform === 'darwin') {
    const path = join(root, 'Library', 'LaunchAgents', `io.dsh-lark.${GUARDIAN_LABEL}.plist`);
    return existsSync(path) ? readFile(path, 'utf8') : undefined;
  }
  return undefined;
}

export function guardianStatePath(root: string): string {
  return join(root, '.dsh-lark', 'guardian.json');
}
