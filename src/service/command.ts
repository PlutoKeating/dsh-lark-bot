import { execFile } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CommandRunner } from './types.js';

export const runCommand: CommandRunner = (command, args, options) =>
  new Promise((resolve) => {
    execFile(
      command,
      [...args],
      {
        env: options?.env,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        let code = 0;
        if (error) {
          const errorCode = (error as NodeJS.ErrnoException & { code?: unknown }).code;
          code = typeof errorCode === 'number' ? errorCode : 1;
        }
        resolve({ code, stdout: stdout ?? '', stderr: stderr ?? '' });
      },
    );
  });

export function resolveCliJsPath(metaUrl: string = import.meta.url): string {
  const current = fileURLToPath(metaUrl);
  const name = basename(current);
  if (name === 'cli.js' || name === 'cli.mjs' || name === 'cli.cjs') return current;
  return join(dirname(current), '..', 'dist', 'cli.js');
}

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'default';
}

export function serviceNameFor(profile: string): string {
  return profile === 'default' ? 'dsh-lark-bot' : `dsh-lark-bot-${slugify(profile)}`;
}

export function launchdLabelFor(profile: string): string {
  return profile === 'default' ? 'io.dsh-lark-bot' : `io.dsh-lark-bot.${slugify(profile)}`;
}
