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
export async function listProcesses(): Promise<ProfileProcess[]> {
  if (process.platform === 'win32') {
    return listProcessesWindows();
  }
  return listProcessesPosix();
}

async function listProcessesPosix(): Promise<ProfileProcess[]> {
  const { stdout } = await captureOutput('ps', ['-axo', 'pid=,args='], 10_000);
  const result: ProfileProcess[] = [];
  for (const line of stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line);
    if (match) {
      result.push({ pid: Number(match[1]), cmdline: match[2] ?? '' });
    }
  }
  return result;
}

async function listProcessesWindows(): Promise<ProfileProcess[]> {
  const { stdout } = await captureOutput(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId, CommandLine | ConvertTo-Csv -NoTypeInformation',
    ],
    10_000,
  );
  const result: ProfileProcess[] = [];
  for (const line of stdout.split('\n').slice(1)) {
    const [pid, ...rest] = line.trim().split(',');
    const numeric = Number(pid?.replace(/"/g, ''));
    if (Number.isInteger(numeric) && rest.length > 0) {
      // Csv quoting can split command lines; join everything after the pid.
      result.push({ pid: numeric, cmdline: rest.join(',').replace(/^"|"$/g, '') });
    }
  }
  return result;
}

export async function captureOutput(
  command: string,
  args: readonly string[],
  timeoutMs: number = 30_000,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
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
