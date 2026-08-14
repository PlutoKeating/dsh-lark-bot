import { readFile } from 'node:fs/promises';
import { writeFileAtomic } from '../platform/atomic-write.js';

const EXTRA_KEYS = ['PATH', 'HOME', 'DEEPSEEK_API_KEY', 'DSH_HOME'] as const;

export function snapshotServiceEnv(
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (key.startsWith('DSH_LARK_') || (EXTRA_KEYS as readonly string[]).includes(key)) {
      env[key] = value;
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
