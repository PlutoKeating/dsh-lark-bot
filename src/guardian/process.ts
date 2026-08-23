import { spawn } from 'node:child_process';

/**
 * Minimal process observation used by the safety-net guardian.
 *
 * The guardian must decide whether "dsh is up" without importing any dsh
 * code: a fresh bridge heartbeat is authoritative, and a live `dsh --profile
 * <name>` process is the fallback (it also catches the case where the bridge
 * never got to write a heartbeat because the profile boot failed).
 */

export interface ProfileProcess {
  pid: number;
  cmdline: string;
}

function commandTokens(cmdline: string): string[] {
  const tokens: string[] = [];
  let token = '';
  let quote: '"' | "'" | undefined;
  const input = cmdline.trim();
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index] ?? '';
    const next = input[index + 1];
    if (character === '\\' && quote === undefined && next !== undefined && /[\s\\"']/u.test(next)) {
      token += next;
      index += 1;
    } else if (character === '\\' && quote === '"' && next === '"') {
      token += next;
      index += 1;
    } else if (quote !== undefined) {
      if (character === quote) quote = undefined;
      else token += character;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (/\s/u.test(character)) {
      if (token !== '') {
        tokens.push(token);
        token = '';
      }
    } else {
      token += character;
    }
  }
  if (token !== '') tokens.push(token);
  return tokens;
}

function isGuardianCliEntry(token: string): boolean {
  const normalized = token.replace(/\\/gu, '/').toLowerCase();
  return (
    normalized.endsWith('/dist/cli.js') &&
    (normalized.includes('/dsh-lark-bot/') || normalized.includes('/dsh-feishu-bot/'))
  );
}

function hasOnlyGuardianRunOptions(tokens: readonly string[]): boolean {
  for (let index = 0; index < tokens.length; index += 2) {
    if (tokens[index] !== '--dsh-profile' && tokens[index] !== '--bridge-profile') return false;
    if (tokens[index + 1] === undefined || tokens[index + 1]?.startsWith('--')) return false;
  }
  return true;
}

/** Match only this package's resident `guardian run` CLI shape. */
export function matchGuardianProcess(cmdline: string): boolean {
  const tokens = commandTokens(cmdline);
  const cliIndex = tokens.findIndex(isGuardianCliEntry);
  if (cliIndex < 1) return false;
  const executable = tokens[cliIndex - 1]?.replace(/\\/gu, '/').split('/').pop()?.toLowerCase();
  if (executable !== 'node' && executable !== 'node.exe') return false;
  if (tokens[cliIndex + 1] !== 'guardian' || tokens[cliIndex + 2] !== 'run') return false;
  return hasOnlyGuardianRunOptions(tokens.slice(cliIndex + 3));
}

function hasProfileFlag(cmdline: string, dshProfile: string): boolean {
  // Match `--profile <name>` with either `=` or space separation; token-level
  // so `--profile dsh-lark-safe` never matches `dsh-lark`.
  const pattern = new RegExp(
    `(?:^|\\s)--profile(?:\\s+|=)${escapeRegExp(dshProfile)}(?:\\s|$)`,
  );
  return pattern.test(cmdline);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function looksLikeDshProcess(cmdline: string): boolean {
  return (
    cmdline.includes('@deepseek-ai/dsh') ||
    // `dsh` as a bare token or as a path basename (e.g. `~/.local/bin/dsh`)
    // followed by whitespace / end of line. The basename form is required for
    // wrapper installs: `node /home/pluto/.local/bin/dsh --profile dsh-lark`.
    /(?:^|[\s/])dsh(?:\.exe)?(?:\s|$)/.test(cmdline)
  );
}

export function matchProfileProcess(
  cmdline: string,
  dshProfile: string,
): boolean {
  // `dsh plugin --profile <name> ...` is a short-lived package-management
  // invocation, not a profile boot; it must never count as the profile being
  // up (it would flip profileSeenUp while the bridge never actually ran).
  if (/(?:^|\s)plugin(?:\s|$)/.test(cmdline)) return false;
  return hasProfileFlag(cmdline, dshProfile) && looksLikeDshProcess(cmdline);
}

/**
 * List `{ pid, cmdline }` for every process on the machine. Uses `ps` on
 * POSIX and PowerShell's CIM query on Windows; both are available on the
 * supported platforms.
 */
export async function listProcesses(
  platform: NodeJS.Platform = process.platform,
  run: typeof captureOutput = captureOutput,
): Promise<ProfileProcess[]> {
  if (platform === 'win32') {
    return listProcessesWindows(run);
  }
  return listProcessesPosix(run);
}

async function listProcessesPosix(run: typeof captureOutput): Promise<ProfileProcess[]> {
  const { stdout } = await run('ps', ['-axo', 'pid=,args='], 10_000);
  const result: ProfileProcess[] = [];
  for (const line of stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line);
    if (match) {
      result.push({ pid: Number(match[1]), cmdline: match[2] ?? '' });
    }
  }
  return result;
}

async function listProcessesWindows(run: typeof captureOutput): Promise<ProfileProcess[]> {
  const { stdout } = await run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress',
    ],
    10_000,
  );
  try {
    const parsed: unknown = JSON.parse(stdout);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.flatMap((row): ProfileProcess[] => {
      if (typeof row !== 'object' || row === null) return [];
      const record = row as Record<string, unknown>;
      const pid = Number(record.ProcessId);
      const cmdline = record.CommandLine;
      return Number.isInteger(pid) && pid > 0 && typeof cmdline === 'string'
        ? [{ pid, cmdline }]
        : [];
    });
  } catch {
    return [];
  }
}

export async function captureOutput(
  command: string,
  args: readonly string[],
  timeoutMs: number = 30_000,
  options: { cwd?: string; env?: NodeJS.ProcessEnv; umask?: number } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const previousUmask = options.umask !== undefined && process.platform !== 'win32'
      ? process.umask(options.umask)
      : undefined;
    const child = (() => {
      try {
        return spawn(command, [...args], {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          ...(options.cwd ? { cwd: options.cwd } : {}),
          ...(options.env ? { env: options.env } : {}),
        });
      } finally {
        if (previousUmask !== undefined) process.umask(previousUmask);
      }
    })();
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', () => {
      resolve({ code: 1, stdout: '', stderr });
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ code: 1, stdout, stderr });
    }, timeoutMs);
    child.once('close', () => clearTimeout(timer));
  });
}

export async function findProfileProcess(
  dshProfile: string,
): Promise<ProfileProcess | undefined> {
  const processes = await listProcesses();
  return processes.find((entry) => matchProfileProcess(entry.cmdline, dshProfile));
}

/** Return a resident guardian only when exactly one live identity is provable. */
export interface GuardianProcessDiscoveryOptions {
  platform?: NodeJS.Platform;
  currentPid?: number;
  uid?: number;
  run?: typeof captureOutput;
  isAlive?: (pid: number) => boolean;
}

async function managedGuardianPid(
  platform: NodeJS.Platform,
  run: typeof captureOutput,
  uid: number,
): Promise<number | undefined> {
  let result: { code: number; stdout: string };
  if (platform === 'linux') {
    result = await run(
      'systemctl',
      ['--user', 'show', 'dsh-lark-guardian.service', '--property=MainPID', '--value'],
      10_000,
    );
  } else if (platform === 'darwin') {
    result = await run(
      'launchctl',
      ['print', `gui/${uid}/io.dsh-lark.dsh-lark-guardian`],
      10_000,
    );
  } else {
    return undefined;
  }
  if (result.code !== 0) return undefined;
  const raw = platform === 'darwin'
    ? /(?:^|\n)\s*pid\s*=\s*(\d+)\s*(?:\n|$)/u.exec(result.stdout)?.[1]
    : /^(\d+)\s*$/u.exec(result.stdout.trim())?.[1];
  const pid = Number(raw);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

export async function findGuardianProcess(
  options: GuardianProcessDiscoveryOptions = {},
): Promise<ProfileProcess | undefined> {
  const platform = options.platform ?? process.platform;
  const run = options.run ?? captureOutput;
  const isAlive = options.isAlive ?? isProcessAlive;
  const currentPid = options.currentPid ?? process.pid;
  const candidates = (await listProcesses(platform, run)).filter(
    (entry) =>
      entry.pid !== currentPid &&
      matchGuardianProcess(entry.cmdline) &&
      isAlive(entry.pid),
  );
  if (candidates.length !== 1) return undefined;
  const candidate = candidates[0];
  if (candidate === undefined) return undefined;
  const servicePid = await managedGuardianPid(
    platform,
    run,
    options.uid ?? process.getuid?.() ?? 0,
  );
  if (servicePid !== undefined && servicePid !== candidate.pid) return undefined;
  return isAlive(candidate.pid) ? candidate : undefined;
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export interface DetachedSpawn {
  pid?: number | undefined;
}

/**
 * Spawn a detached process that keeps running after the guardian exits
 * (used to relaunch the full dsh profile when leaving safe mode). stdio is
 * ignored so the relaunched profile never shares the guardian's console.
 */
export function spawnDetached(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): DetachedSpawn {
  const child = spawn(command, [...args], {
    detached: process.platform !== 'win32',
    stdio: 'ignore',
    windowsHide: true,
    env: { ...env },
  });
  if (child.pid !== undefined && process.platform !== 'win32') {
    child.unref();
  }
  return { pid: child.pid };
}
