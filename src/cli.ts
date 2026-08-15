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
