import { spawn } from 'cross-spawn';
import { createInterface } from 'node:readline';
import type { ChildProcess } from 'node:child_process';
import { checkDshAvailability } from './availability.js';
import { plainOutputEvent, translateDshLine } from './translate.js';
import type {
  AgentAdapter,
  AgentAvailability,
  AgentEvent,
  AgentRun,
  AgentRunOptions,
} from '../types.js';

export interface DshAdapterOptions {
  command?: string;
  args?: string[];
  stopGraceMs?: number;
}

type DshChild = ChildProcess;

export class DshAdapter implements AgentAdapter {
  readonly id = 'dsh';
  readonly displayName = 'DeepSeek Harness';

  private readonly command: string;
  private readonly args: string[];
  private readonly stopGraceMs: number;

  constructor(options: DshAdapterOptions = {}) {
    this.command = options.command ?? 'dsh';
    this.args = options.args ?? ['--profile', 'headless'];
    this.stopGraceMs = options.stopGraceMs ?? 5_000;
  }

  async isAvailable(): Promise<boolean> {
    return (await this.checkAvailability()).ok;
  }

  checkAvailability(): Promise<AgentAvailability> {
    return checkDshAvailability({ command: this.command, args: this.args });
  }

  run(options: AgentRunOptions): AgentRun {
    const prompt =
      options.images?.length
        ? `${options.prompt}\n\nImage files attached to this message:\n${options.images.join('\n')}`
        : options.prompt;

    const child = spawn(
      this.command,
      [...this.args, prompt],
      {
        cwd: options.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    ) as DshChild;

    child.stdin?.end();

    const stderrChunks: Buffer[] = [];
    let runtimeError: Error | null = null;
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });
    child.on('error', (error: Error) => {
      runtimeError = error;
    });

    return {
      runId: options.runId,
      events: createEventStream(child, stderrChunks, () => runtimeError, {
        sessionId: options.sessionId,
        cwd: options.cwd,
        model: options.model,
      }),
      stop: () => stopChild(child, this.stopGraceMs),
      waitForExit: (timeoutMs) => waitForChildExit(child, timeoutMs),
    };
  }
}

async function* createEventStream(
  child: DshChild,
  stderrChunks: Buffer[],
  getError: () => Error | null,
  system: {
    sessionId: string | undefined;
    cwd: string | undefined;
    model: string | undefined;
  },
): AsyncGenerator<AgentEvent> {
  if (!child.pid) {
    const error = getError();
    yield {
      type: 'error',
      message: error ? `failed to spawn dsh: ${error.message}` : 'spawn returned no pid',
      terminationReason: 'failed',
    };
    return;
  }

  yield {
    type: 'system',
    sessionId: system.sessionId,
    cwd: system.cwd,
    model: system.model,
  };

  if (!child.stdout) {
    yield {
      type: 'error',
      message: 'dsh stdout stream is unavailable',
      terminationReason: 'failed',
    };
    return;
  }

  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const plainLines: string[] = [];
  let emittedProtocol = false;
  let terminalEmitted = false;

  for await (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const events = translateDshLine(trimmed);
    if (events.length > 0) {
      emittedProtocol = true;
      for (const event of events) {
        if (event.type === 'done' || event.type === 'error') terminalEmitted = true;
        yield event;
      }
    } else {
      plainLines.push(trimmed);
    }
  }

  const exitCode = await waitForExitResult(child, 0).then((value) => value.code);
  const runtimeError = getError();

  if (!terminalEmitted) {
    if (exitCode !== null && exitCode !== 0) {
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
      const detail = stderr ? `: ${stderr.slice(0, 500)}` : '';
      yield {
        type: 'error',
        message: `dsh exited with code ${exitCode}${detail}`,
        terminationReason: 'failed',
      };
      return;
    }

    if (runtimeError) {
      yield {
        type: 'error',
        message: `dsh runtime error: ${runtimeError.message}`,
        terminationReason: 'failed',
      };
      return;
    }

    if (emittedProtocol) {
      yield { type: 'done', sessionId: system.sessionId, terminationReason: 'normal' };
    } else {
      yield* plainOutputEvent(plainLines.join('\n'));
      yield { type: 'done', sessionId: system.sessionId, terminationReason: 'normal' };
    }
  }
}

async function waitForExitResult(
  child: DshChild,
  timeoutMs: number,
): Promise<{ code: number | null; timedOut: boolean }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, timedOut: false };
  }

  return new Promise((resolve) => {
    const onExit = (code: number | null): void => {
      if (timer !== undefined) clearTimeout(timer);
      resolve({ code, timedOut: false });
    };
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            child.removeListener('exit', onExit);
            resolve({ code: child.exitCode, timedOut: true });
          }, timeoutMs)
        : undefined;
    child.once('exit', onExit);
  });
}

async function stopChild(child: DshChild, graceMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const stopped = await waitForExitResult(child, graceMs);
  if (!stopped.timedOut) return;
  child.kill('SIGKILL');
}

async function waitForChildExit(child: DshChild, timeoutMs: number): Promise<boolean> {
  const result = await waitForExitResult(child, timeoutMs);
  return !result.timedOut && result.code !== null;
}
