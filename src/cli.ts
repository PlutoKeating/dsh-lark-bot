import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { runStart } from './cli/commands/start.js';

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

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('dsh-lark-bot')
    .description('Bridge DeepSeek Harness into Feishu / Lark')
    .version(packageVersion(), '-v, --version');

  program
    .command('start')
    .description('Start the bridge in the foreground')
    .option('--profile <name>', 'profile name')
    .option('--workspace <path>', 'initial working directory')
    .option('--app-id <id>', 'existing Lark/Feishu app id')
    .option('--app-secret <secret>', 'existing Lark/Feishu app secret')
    .option('--tenant <tenant>', 'feishu or lark')
    .action(async (opts: StartOptions) => {
      await runStart(opts);
    });

  program
    .command('doctor')
    .description('Run local diagnostics')
    .action(async () => {
      process.stdout.write('dsh-lark-bot doctor: not implemented yet\n');
    });

  return program;
}

export async function main(argv: readonly string[] = process.argv): Promise<void> {
  await buildProgram().parseAsync([...argv]);
}
