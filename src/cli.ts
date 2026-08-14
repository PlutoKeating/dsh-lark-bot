import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { runDoctor } from './cli/commands/doctor.js';
import { runBot } from './cli/commands/run.js';
import { runServiceStart, runServiceCommand } from './cli/commands/service.js';
import { runSupervise } from './cli/commands/supervise.js';

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

  addBotOptions(
    program
      .command('start')
      .description('Install and start the background service (autostart + auto-restart)'),
  ).action(async (opts: StartOptions) => {
    await runServiceStart(opts, { version: packageVersion() });
  });

  addBotOptions(program.command('status').description('Show background service status')).action(
    async (opts: StartOptions) => {
      await runServiceCommand('status', opts, { version: packageVersion() });
    },
  );

  addBotOptions(program.command('restart').description('Restart the background service')).action(
    async (opts: StartOptions) => {
      await runServiceCommand('restart', opts, { version: packageVersion() });
    },
  );

  addBotOptions(program.command('stop').description('Stop the background service and remove autostart')).action(
    async (opts: StartOptions) => {
      await runServiceCommand('stop', opts, { version: packageVersion() });
    },
  );

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

  addBotOptions(
    program
      .command('run', { hidden: true })
      .description('Run the bridge process (managed by the background service; not for interactive use)'),
  ).action(async (opts: StartOptions) => {
    await runBot(opts);
  });

  addBotOptions(
    program
      .command('supervise', { hidden: true })
      .description('Supervisor loop for the portable background service; not for interactive use'),
  ).action(async (opts: StartOptions) => {
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
