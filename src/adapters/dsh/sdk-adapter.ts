import { randomUUID } from 'node:crypto';
import {
  DeepSeekHarness,
  HarnessClient,
} from '@deepseek-ai/dsh-sdk-client';
import type {
  AgentAdapter,
  AgentAvailability,
  AgentRun,
  AgentRunOptions,
} from '../types.js';
import { createSdkRun } from './sdk-translate.js';
import type { SdkLaunchSpec } from './sdk-runtime.js';

export interface SdkAdapterOptions {
  /** Launch spec for the SDK runtime subprocess (command + args, no cwd). */
  launch: SdkLaunchSpec;
  provider: string;
  model: string;
  maxTokens?: number;
  /** Per-request timeout for the availability probe. */
  probeTimeoutMs?: number;
  /** Injectable harness factory for tests. */
  harnessFactory?: (cwd: string) => DeepSeekHarness;
}

interface RuntimeEntry {
  harness: DeepSeekHarness;
}

function waitWithTimeout(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs > 0 ? timeoutMs : 5_000);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve(true);
      },
      () => {
        clearTimeout(timer);
        resolve(true);
      },
    );
  });
}

/**
 * Official DeepSeek Harness SDK adapter. Replaces the hand-written headless
 * subprocess protocol with `@deepseek-ai/dsh-sdk-client`: one runtime per
 * workspace cwd, native `session(id)` continuation, and token-level streaming
 * events (`assistant/chunk` reasoning/text deltas).
 */
export class SdkDshAdapter implements AgentAdapter {
  readonly id = 'dsh-sdk';
  readonly displayName = 'DeepSeek Harness (SDK)';
  readonly resumeCapable = true;

  private readonly launch: SdkLaunchSpec;
  private readonly provider: string;
  private readonly model: string;
  private readonly maxTokens: number | undefined;
  private readonly probeTimeoutMs: number;
  private readonly harnessFactory: (cwd: string) => DeepSeekHarness;
  private readonly runtimes = new Map<string, RuntimeEntry>();
  private disposed = false;

  constructor(options: SdkAdapterOptions) {
    this.launch = options.launch;
    this.provider = options.provider;
    this.model = options.model;
    this.maxTokens = options.maxTokens;
    this.probeTimeoutMs = options.probeTimeoutMs ?? 15_000;
    this.harnessFactory = options.harnessFactory ?? ((cwd) => this.createHarness(cwd));
  }

  async isAvailable(): Promise<boolean> {
    return (await this.checkAvailability()).ok;
  }

  async checkAvailability(): Promise<AgentAvailability> {
    if (this.disposed) {
      return { ok: false, error: 'adapter disposed', version: undefined };
    }
    const client = new HarnessClient({
      command: this.launch.command,
      args: this.launch.args,
      cwd: process.cwd(),
      requestTimeoutMs: this.probeTimeoutMs,
    });
    try {
      client.start();
      const info = await client.initialize({
        cwd: process.cwd(),
        provider: this.provider,
        model: this.model,
        ...(this.maxTokens === undefined ? {} : { maxTokens: this.maxTokens }),
      });
      return {
        ok: true,
        error: undefined,
        version: `${info.serverInfo.name}@${info.serverInfo.version}`,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        version: undefined,
      };
    } finally {
      await client.close();
    }
  }

  run(options: AgentRunOptions): AgentRun {
    const cwd = options.cwd ?? process.cwd();
    const entry = this.runtimeFor(cwd);
    const sessionId =
      options.sessionId ?? `session-${randomUUID().replaceAll('-', '')}`;
    const stopRequested = { value: false };
    const handle = createSdkRun(entry.harness, options.prompt, {
      sessionId,
      cwd,
      model: options.model ?? this.model,
      images: options.images,
      stopRequested,
    });

    return {
      runId: options.runId,
      events: handle.events,
      stop: async () => {
        stopRequested.value = true;
        await this.closeRuntime(cwd);
      },
      waitForExit: (timeoutMs) => waitWithTimeout(handle.settled, timeoutMs),
    };
  }

  /** Close every runtime subprocess (used on bridge shutdown). */
  async dispose(): Promise<void> {
    this.disposed = true;
    const entries = [...this.runtimes.values()];
    this.runtimes.clear();
    await Promise.allSettled(
      entries.map((entry) => entry.harness.close()),
    );
  }

  private createHarness(cwd: string): DeepSeekHarness {
    return new DeepSeekHarness({
      launch: {
        command: this.launch.command,
        args: this.launch.args,
        cwd,
      },
      cwd,
      provider: this.provider,
      model: this.model,
      ...(this.maxTokens === undefined ? {} : { maxTokens: this.maxTokens }),
    });
  }

  private runtimeFor(cwd: string): RuntimeEntry {
    if (this.disposed) {
      throw new Error('SdkDshAdapter is disposed');
    }
    const existing = this.runtimes.get(cwd);
    if (existing) return existing;
    const entry: RuntimeEntry = { harness: this.harnessFactory(cwd) };
    this.runtimes.set(cwd, entry);
    return entry;
  }

  private async closeRuntime(cwd: string): Promise<void> {
    const entry = this.runtimes.get(cwd);
    if (!entry) return;
    this.runtimes.delete(cwd);
    try {
      await entry.harness.close();
    } catch (error) {
      // Closing is best-effort; the runtime process teardown ladder is
      // already idempotent inside the SDK client.
      void error;
    }
  }
}
