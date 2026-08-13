import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface DshRuntimeSpec {
  command: string;
  args: string[];
  bin?: string;
}

const DS_HARNESS_RELATIVE = join('@deepseek-ai', 'dsh', 'lib', 'bin.js');

function firstExisting(...paths: string[]): string | undefined {
  return paths.find((path) => existsSync(path));
}

function children(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => join(root, entry.name));
  } catch {
    return [];
  }
}

export function discoverDshBin(
  home: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const dshHome = env.DSH_HOME?.trim() || join(home, '.dsh');

  const candidates = [
    join(dshHome, 'profiles', 'node_modules', DS_HARNESS_RELATIVE),
    join(home, '.npm', '_npx', 'node_modules', DS_HARNESS_RELATIVE),
    join(home, '.cache', 'pnpm', 'dlx', 'node_modules', DS_HARNESS_RELATIVE),
    join(home, '.local', 'share', 'pnpm', 'node_modules', DS_HARNESS_RELATIVE),
  ];

  const direct = firstExisting(...candidates);
  if (direct) return direct;

  for (const root of [join(home, '.npm', '_npx'), join(home, '.cache', 'pnpm', 'dlx')]) {
    for (const child of children(root)) {
      const path = join(child, 'node_modules', DS_HARNESS_RELATIVE);
      if (existsSync(path)) return path;
    }
  }

  return undefined;
}

export function resolveDshRuntime(
  input: {
    command?: string;
    args?: string[];
    home: string;
    env?: NodeJS.ProcessEnv;
  },
): DshRuntimeSpec {
  if (input.command || input.args) {
    return {
      command: input.command ?? 'node',
      args: input.args ?? ['--profile', 'headless'],
    };
  }

  const bin = discoverDshBin(input.home, input.env);
  if (bin) {
    return {
      command: 'node',
      args: [bin, '--profile', 'headless'],
      bin,
    };
  }

  return {
    command: 'dsh',
    args: ['--profile', 'headless'],
  };
}
