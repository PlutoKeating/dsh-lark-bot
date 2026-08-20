import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { runDoctor } from './cli/commands/doctor.js';
import { runBot } from './cli/commands/run.js';
import { runSetup } from './cli/commands/setup.js';
import { runUpgrade } from './cli/commands/upgrade.js';
import {
  installGuardianCommand,
  runGuardian,
  statusGuardianCommand,
  uninstallGuardianCommand,
} from './cli/commands/guardian.js';
import { runServiceCommand } from './cli/commands/service.js';
import { runSupervise } from './cli/commands/supervise.js';
import { runServiceRuntime } from './cli/commands/service-run.js';
import { runBotCommand, type BotCommandOptions } from './cli/commands/bot.js';

function packageVersion(): string {
  const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
  const pkg = JSON.parse(raw) as { version?: unknown };
  return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
}

export interface StartOptions {
  profile?: string;
  workspace?: string;
  appId?: string;
  appSecret?: string;
  tenant?: string;
}

function addBotOptions(command: Command): Command {
  return command
    .option('--profile <name>', 'profile name')
    .option('--workspace <path>', 'initial working directory')
    .option('--app-id <id>', 'existing Lark/Feishu app id')
    .option('--app-secret <secret>', 'existing Lark/Feishu app secret')
    .option('--tenant <tenant>', 'feishu or lark');
}

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('dsh-lark-bot')
    .description('Bridge DeepSeek Harness into Feishu / Lark')
    .version(packageVersion(), '-v, --version');

  program
    .command('setup')
    .description(
      'Install this package as a standard dsh profile bundle (single install path)',
    )
    .option('--profile <name>', 'dsh profile to install into (default: dsh-lark)')
    .option('--guardian', 'install the safety-net guardian service (installed by default; compatibility)')
    .option('--no-guardian', 'skip installing the safety-net guardian service (installed by default)')
    .action(async (opts: { profile?: string; guardian?: boolean }) => {
      await runSetup({
        ...(opts.profile ? { profile: opts.profile } : {}),
        guardian: opts.guardian !== false,
      });
    });

  program
    .command('doctor')
    .description('Run local diagnostics')
    .option('--profile <name>', 'profile name')
    .option('--workspace <path>', 'initial working directory')
    .option('--app-id <id>', 'existing Lark/Feishu app id')
    .option('--app-secret <secret>', 'existing Lark/Feishu app secret')
    .option('--tenant <tenant>', 'feishu or lark')
    .action(async (opts: StartOptions) => {
      await runDoctor({ ...opts, version: packageVersion() });
    });

  program
    .command('upgrade')
    .description(
      'One-command full upgrade: package + guardian + runtime profiles, running-instance safe (issue #10)',
    )
    .option('--profile <name>', 'dsh profile to upgrade (default: dsh-lark)')
    .option('--check', 'report installed vs latest versions and running state without changing anything')
    .option('-y, --yes', 'skip the interactive confirmation')
    .option('--no-guardian', 'do not install / upgrade the safety-net guardian')
    .option('--restart', 'restart the guardian service and (managed) dsh profile after upgrading')
    .option('--rollback', 'reinstall the previously recorded version')
    .option('--force', 'proceed with the running package version when npm latest is unreachable')
    .option('--package <spec>', 'explicit name@version spec (advanced)')
    .action(async (opts: {
      profile?: string;
      check?: boolean;
      yes?: boolean;
      guardian?: boolean;
      restart?: boolean;
      rollback?: boolean;
      force?: boolean;
      package?: string;
    }) => {
      await runUpgrade({
        ...(opts.profile ? { profile: opts.profile } : {}),
        check: opts.check === true,
        yes: opts.yes === true,
        guardian: opts.guardian !== false,
        restart: opts.restart === true,
        rollback: opts.rollback === true,
        force: opts.force === true,
        ...(opts.package ? { packageSpec: opts.package } : {}),
      });
    });

  addBotOptions(
    program
      .command('run', { hidden: true })
      .description('Run the bridge engine directly (diagnostics; the dsh plugin runs it in-process)'),
  ).action(async (opts: StartOptions) => {
    await runBot(opts);
  });

  const guardian = program
    .command('guardian')
    .description(
      'Safety-net guardian: a minimal process independent of dsh that keeps the Feishu rescue entrance alive',
    );

  guardian
    .command('run')
    .description('Run the guardian in the foreground (system service entry point)')
    .option('--dsh-profile <name>', 'dsh profile to watch / relaunch (default from state)')
    .option('--bridge-profile <name>', 'bridge state profile with Feishu credentials')
    .action(async (opts: { dshProfile?: string; bridgeProfile?: string }) => {
      await runGuardian(opts);
    });

  guardian
    .command('install')
    .description('Install the guardian as a system-level resident service')
    .option('--dsh-profile <name>', 'dsh profile to watch / relaunch (default: dsh-lark)')
    .option('--bridge-profile <name>', 'bridge state profile (default: default)')
    .action(async (opts: { dshProfile?: string; bridgeProfile?: string }) => {
      await installGuardianCommand(opts);
    });

  guardian
    .command('uninstall')
    .description('Remove the system service entry (state file is kept)')
    .action(async () => {
      await uninstallGuardianCommand();
    });

  guardian
    .command('status')
    .description('Show guardian / dsh / safe-mode state')
    .option('--dsh-profile <name>', 'dsh profile to inspect')
    .option('--bridge-profile <name>', 'bridge state profile to inspect')
    .action(async (opts: { dshProfile?: string; bridgeProfile?: string }) => {
      await statusGuardianCommand(opts);
    });

  const service = program
    .command('service')
    .description('Install and manage the canonical dsh profile as a user background service');
  for (const action of ['install', 'start', 'status', 'restart', 'stop', 'uninstall'] as const) {
    service
      .command(action)
      .description(`${action} the managed dsh profile service`)
      .option('--profile <name>', 'dsh profile (default: dsh-lark)')
      .action(async (opts: { profile?: string }) => {
        await runServiceCommand(action, opts, { version: packageVersion() });
      });
  }
  service
    .command('logs')
    .description('Show managed profile logs')
    .option('--profile <name>', 'dsh profile (default: dsh-lark)')
    .option('-n, --lines <count>', 'number of trailing lines', '100')
    .option('-f, --follow', 'follow new log output')
    .action(async (opts: { profile?: string; lines?: string; follow?: boolean }) => {
      const lines = Number.parseInt(opts.lines ?? '100', 10);
      await runServiceCommand('logs', {
        ...(opts.profile ? { profile: opts.profile } : {}),
        lines: Number.isFinite(lines) ? lines : 100,
        follow: opts.follow === true,
      }, { version: packageVersion() });
    });

  const bots = program
    .command('bot')
    .description('Add, inspect and remove isolated Feishu/Lark bot instances');
  bots.command('add <name>')
    .description('Create and start an isolated bot instance')
    .option('--app-id <id>', 'existing Feishu/Lark app id (otherwise QR onboarding)')
    .option('--app-secret <secret>', 'existing Feishu/Lark app secret')
    .option('--tenant <tenant>', 'feishu or lark')
    .option('--workspace <path>', 'default workspace')
    .option('--model <route>', 'default provider/model route')
    .action(async (name: string, opts: BotCommandOptions) => {
      await runBotCommand('add', { name, ...opts }, { version: packageVersion() });
    });
  bots.command('list')
    .description('List bot instances and service state')
    .action(async () => runBotCommand('list', {}, { version: packageVersion() }));
  bots.command('status <name>')
    .description('Show one bot instance')
    .action(async (name: string) => runBotCommand('status', { name }, { version: packageVersion() }));
  bots.command('remove <name>')
    .description('Stop and remove one instance while preserving its session data')
    .action(async (name: string) => runBotCommand('remove', { name }, { version: packageVersion() }));

  program
    .command('service-run', { hidden: true })
    .description('Run a managed dsh profile with its private environment snapshot')
    .option('--profile <name>', 'dsh profile (default: dsh-lark)')
    .requiredOption('--env-file <path>', 'private service environment snapshot')
    .action(async (opts: { profile?: string; envFile: string }) => {
      await runServiceRuntime(opts);
    });

  program
    .command('service-supervise', { hidden: true })
    .description('Portable service supervisor')
    .option('--profile <name>', 'dsh profile (default: dsh-lark)')
    .requiredOption('--env-file <path>', 'private service environment snapshot')
    .action(async (opts: { profile?: string; envFile: string }) => {
      await runSupervise(opts);
    });

  return program;
}

export async function main(argv: readonly string[] = process.argv): Promise<void> {
  await buildProgram().parseAsync([...argv]);
}

/**
 * True when this module is being executed directly (e.g. `node dist/cli.js run`)
 * rather than imported by a bin wrapper. The background service runs
 * `node <package>/dist/cli.js run`, so the bundle must self-execute in that case.
 */
export function isDirectInvocation(
  entry: string | undefined = process.argv[1],
  metaUrl: string = import.meta.url,
): boolean {
  if (!entry) return false;
  try {
    return realpathSync(entry) === fileURLToPath(metaUrl);
  } catch {
    return false;
  }
}

if (isDirectInvocation()) {
  await main();
}
