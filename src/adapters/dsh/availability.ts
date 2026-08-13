import { spawn } from 'cross-spawn';
import type { AgentAvailability } from '../types.js';

export interface AvailabilityCheckOptions {
  command: string;
  timeoutMs?: number;
}

export async function checkDshAvailability(
  options: AvailabilityCheckOptions,
): Promise<AgentAvailability> {
  const timeoutMs = options.timeoutMs ?? 5_000;

  return new Promise((resolve) => {
    const child = spawn(options.command, ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (result: AgentAvailability): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ ok: false, error: `timed out after ${timeoutMs}ms`, version: undefined });
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      finish({ ok: false, error: error.message, version: undefined });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      const version = stdout.trim();
      if (code !== 0 && !version) {
        finish({ ok: false, error: stderr.trim() || `exited with code ${String(code)}`, version: undefined });
        return;
      }
      finish({ ok: true, error: undefined, version: version || undefined });
    });
  });
}
