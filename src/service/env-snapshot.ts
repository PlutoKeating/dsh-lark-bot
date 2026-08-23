import { readFile } from 'node:fs/promises';
import { writeFileAtomic } from '../platform/atomic-write.js';
import { runCommand } from './command.js';
import type { CommandRunner } from './types.js';

const EXTRA_KEYS = ['PATH', 'HOME', 'DEEPSEEK_API_KEY', 'DSH_HOME'] as const;

export function snapshotServiceEnv(
  source: NodeJS.ProcessEnv = process.env,
  extraKeys: readonly string[] = [],
  inherited: NodeJS.ProcessEnv = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const candidate of [inherited, source]) {
    for (const [key, value] of Object.entries(candidate)) {
      if (value === undefined) continue;
      if (
        key.startsWith('DSH_LARK_') ||
        (EXTRA_KEYS as readonly string[]).includes(key) ||
        extraKeys.includes(key)
      ) {
        env[key] = value;
      }
    }
  }
  return env;
}

export function formatEnvFile(env: Record<string, string>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`invalid service env key: ${key}`);
    }
    if (/[\r\n]/.test(value)) {
      throw new Error(`service env value for ${key} contains a newline`);
    }
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    lines.push(`${key}="${escaped}"`);
  }
  return `${lines.join('\n')}\n`;
}

export function parseEnvFile(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\(.)/g, '$1');
    } else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

export async function writeServiceEnv(
  file: string,
  env: Record<string, string>,
): Promise<void> {
  await writeFileAtomic(file, formatEnvFile(env), { mode: 0o600 });
}

export async function readServiceEnv(file: string): Promise<Record<string, string>> {
  try {
    return parseEnvFile(await readFile(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

/** Windows has no POSIX mode bits; replace inherited ACLs with current-user full control. */
export async function secureWindowsServiceEnv(
  file: string,
  runner: CommandRunner = runCommand,
): Promise<void> {
  const identity = await runner('whoami.exe', ['/user', '/fo', 'csv', '/nh']);
  const sid = identity.code === 0
    ? identity.stdout.match(/S-\d+(?:-\d+)+/i)?.[0]
    : undefined;
  if (!sid) {
    throw new Error('无法解析当前 Windows access token SID；拒绝保存后台服务凭据快照。');
  }
  const result = await runner('icacls.exe', [
    file,
    '/inheritance:r',
    '/grant:r',
    `*${sid}:(F)`,
  ]);
  if (result.code !== 0) {
    throw new Error(
      `无法收紧后台服务凭据文件 ACL（exit ${result.code}）：${result.stderr.trim() || result.stdout.trim() || '未知错误'}`,
    );
  }
}
