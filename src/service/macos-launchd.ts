import { mkdir, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { writeFileAtomic } from '../platform/atomic-write.js';
import { runCommand } from './command.js';
import type {
  CommandRunner,
  ServiceController,
  ServicePlatform,
  ServiceRuntimeState,
  ServiceSpec,
  ServiceStatus,
} from './types.js';

export interface LaunchdControllerOptions {
  runCommand?: CommandRunner;
  launchAgentDir?: string;
  uid?: number;
}

export function defaultLaunchAgentDir(): string {
  return join(homedir(), 'Library', 'LaunchAgents');
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildLaunchdPlist(spec: ServiceSpec): string {
  const programArguments = [spec.commandPath, ...spec.commandArgs]
    .map((argument) => `    <string>${xmlEscape(argument)}</string>`)
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${xmlEscape(spec.label)}</string>`,
  '  <key>ProgramArguments</key>',
  '  <array>',
    programArguments,
    '  </array>',
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>KeepAlive</key>',
    '  <true/>',
    '  <key>StandardOutPath</key>',
    `  <string>${xmlEscape(spec.logFile)}</string>`,
    '  <key>StandardErrorPath</key>',
    `  <string>${xmlEscape(spec.logFile)}</string>`,
    '  <key>ProcessType</key>',
    '  <string>Background</string>',
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export class LaunchdServiceController implements ServiceController {
  readonly platform: ServicePlatform = 'darwin-launchd';

  private readonly run: CommandRunner;
  private readonly agentDir: string;
  private readonly uid: number;

  constructor(options: LaunchdControllerOptions = {}) {
    this.run = options.runCommand ?? runCommand;
    this.agentDir = options.launchAgentDir ?? defaultLaunchAgentDir();
    this.uid = options.uid ?? process.getuid?.() ?? -1;
  }

  private domain(): string {
    return `gui/${this.uid}`;
  }

  private plistPath(spec: ServiceSpec): string {
    return join(this.agentDir, `${spec.label}.plist`);
  }

  private serviceRef(spec: ServiceSpec): string {
    return `${this.domain()}/${spec.label}`;
  }

  async installAndStart(spec: ServiceSpec): Promise<void> {
    await mkdir(this.agentDir, { recursive: true });
    await writeFileAtomic(this.plistPath(spec), buildLaunchdPlist(spec));
    const bootstrap = await this.run('launchctl', ['bootstrap', this.domain(), this.plistPath(spec)]);
    if (bootstrap.code !== 0) {
      // Already loaded: kill and restart to pick up the refreshed plist.
      const kickstart = await this.run('launchctl', ['kickstart', '-k', this.serviceRef(spec)]);
      if (kickstart.code !== 0) {
        throw new Error(
          kickstart.stderr.trim() || bootstrap.stderr.trim() || 'launchd bootstrap failed',
        );
      }
    }
  }

  async start(spec: ServiceSpec): Promise<void> {
    const kickstart = await this.run('launchctl', ['kickstart', this.serviceRef(spec)]);
    if (kickstart.code === 0) return;
    const bootstrap = await this.run('launchctl', ['bootstrap', this.domain(), this.plistPath(spec)]);
    if (bootstrap.code !== 0) {
      throw new Error(bootstrap.stderr.trim() || kickstart.stderr.trim() || 'launchd start failed');
    }
  }

  async stop(spec: ServiceSpec): Promise<void> {
    await this.run('launchctl', ['bootout', this.serviceRef(spec)]);
  }

  async restart(spec: ServiceSpec): Promise<void> {
    const kickstart = await this.run('launchctl', ['kickstart', '-k', this.serviceRef(spec)]);
    if (kickstart.code !== 0) {
      await this.installAndStart(spec);
    }
  }

  async uninstall(spec: ServiceSpec): Promise<void> {
    await this.run('launchctl', ['bootout', this.serviceRef(spec)]);
    await rm(this.plistPath(spec), { force: true });
  }

  async status(spec: ServiceSpec): Promise<ServiceStatus> {
    const plistExists = await fileExists(this.plistPath(spec));
    const printed = await this.run('launchctl', ['print', this.serviceRef(spec)]);
    const loaded = printed.code === 0;
    let pid: number | undefined;
    let state: ServiceRuntimeState = 'stopped';
    let detail = loaded ? 'loaded' : 'not loaded';

    if (loaded) {
      const pidMatch = /pid = (\d+)/.exec(printed.stdout);
      if (pidMatch?.[1]) pid = Number(pidMatch[1]);
      if (/state = running/.test(printed.stdout)) {
        state = 'running';
        detail = 'running';
      } else if (/state = exited|state = waiting/.test(printed.stdout)) {
        state = 'stopped';
        detail = /state = exited/.test(printed.stdout) ? 'exited' : 'waiting';
      }
    }

    return {
      name: spec.serviceName,
      platform: this.platform,
      installed: plistExists,
      autostartEnabled: plistExists,
      state,
      pid,
      detail,
      restarts: undefined,
    };
  }
}
