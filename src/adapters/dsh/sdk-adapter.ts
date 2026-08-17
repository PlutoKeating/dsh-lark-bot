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
  harnessFactory?: (cwd: string, route: ModelRoute) => DeepSeekHarness;
}

interface RuntimeEntry {
  harness: DeepSeekHarness;
  provider: string;
  model: string;
  /** Number of runs currently holding this harness. */
  active: number;
  /** True once this entry has been superseded by a new route. */
  retired: boolean;
}

export interface ModelRoute {
  provider: string;
  model: string;
}

/**
 * The dsh SDK runtime registers llm-pi-ai provider routes asynchronously a
 * few hundred ms after boot. An initialize handshake sent inside that window
 * fails with "no adapter registered for provider <id>" even though the
 * provider is correctly configured; deepseek-official registers synchronously
 * so only pi-ai providers are affected. Retry the handshake with backoff.
 */
const RETRYABLE_INIT_ERROR = /no adapter registered for provider/i;
const INIT_RETRY_ATTEMPTS = 6;
const INIT_RETRY_DELAY_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableInitError(error: unknown): boolean {
  return error instanceof Error && RETRYABLE_INIT_ERROR.test(error.message);
}

/**
 * Wrap a harness so its start handshake survives the transient pi-ai
 * registration race. The race is per runtime boot: llm-pi-ai registers its
 * provider routes a few hundred ms AFTER the JSON-RPC server starts serving,
 * so re-spawning the runtime resets the clock. We therefore keep the SAME
 * subprocess and poll `initialize` until the routes are registered.
 */
function withRetryableStart(harness: DeepSeekHarness): DeepSeekHarness {
  const originalStart = harness.start.bind(harness);
  const internals = harness as unknown as {
    client: HarnessClient;
    cwd: string;
    provider: string;
    model: string;
    initialized: Promise<void> | undefined;
  };
  let handled = false;
  harness.start = async () => {
    if (handled) return originalStart();
    try {
      const result = await originalStart();
      handled = true;
      return result;
    } catch (error) {
      if (!isRetryableInitError(error)) throw error;
      handled = true;
      // originalStart() closed its client on failure and swapped in a fresh
      // one. Boot that subprocess and poll initialize on the SAME process.
      const client = internals.client;
      if (!client) throw error;
      client.start();
      let lastError: unknown = error;
      for (let attempt = 1; attempt <= INIT_RETRY_ATTEMPTS; attempt += 1) {
        await sleep(INIT_RETRY_DELAY_MS * attempt);
        try {
          await client.initialize({
            cwd: internals.cwd,
            provider: internals.provider,
            model: internals.model,
          });
          // Mark the harness initialized so later runs reuse this runtime
          // instead of spawning another subprocess.
          internals.initialized = Promise.resolve();
          return undefined;
        } catch (retryError) {
          lastError = retryError;
          if (!isRetryableInitError(retryError)) throw retryError;
        }
      }
      throw lastError;
    }
  };
  return harness;
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
  private readonly harnessFactory: (cwd: string, route: ModelRoute) => DeepSeekHarness;
  private readonly runtimes = new Map<string, RuntimeEntry>();
  /** Retired harnesses still draining in-flight runs; closed when idle. */
  private readonly draining = new Set<RuntimeEntry>();
  private disposed = false;

  constructor(options: SdkAdapterOptions) {
    this.launch = options.launch;
    this.provider = options.provider;
    this.model = options.model;
    this.maxTokens = options.maxTokens;
    this.probeTimeoutMs = options.probeTimeoutMs ?? 15_000;
    this.harnessFactory =
      options.harnessFactory ?? ((cwd, route) => this.createHarness(cwd, route));
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
      let lastError: unknown;
      for (let attempt = 1; attempt <= INIT_RETRY_ATTEMPTS; attempt += 1) {
        try {
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
          lastError = error;
          if (!isRetryableInitError(error) || attempt === INIT_RETRY_ATTEMPTS) {
            return {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
              version: undefined,
            };
          }
          await sleep(INIT_RETRY_DELAY_MS * attempt);
        }
      }
      return {
        ok: false,
        error: lastError instanceof Error ? lastError.message : String(lastError),
        version: undefined,
      };
    } finally {
      await client.close();
    }
  }

  run(options: AgentRunOptions): AgentRun {
    const cwd = options.cwd ?? process.cwd();
    const route: ModelRoute = {
      provider: options.provider ?? this.provider,
      model: options.model ?? this.model,
    };
    const entry = this.runtimeFor(cwd, route);
    const sessionId =
      options.sessionId ?? `session-${randomUUID().replaceAll('-', '')}`;
    const stopRequested = { value: false };
    entry.active += 1;
    const handle = createSdkRun(entry.harness, options.prompt, {
      sessionId,
      cwd,
      model: options.model ?? this.model,
      images: options.images,
      stopRequested,
    });
    // Release the harness when the SDK turn settles; a retired harness is
    // closed as soon as the last in-flight run on it finishes.
    void handle.settled
      .finally(() => this.releaseEntry(entry))
      .catch(() => undefined);

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
    const draining = [...this.draining];
    this.draining.clear();
    await Promise.allSettled(
      [...entries, ...draining].map((entry) => entry.harness.close()),
    );
  }

  private createHarness(cwd: string, route: ModelRoute): DeepSeekHarness {
    return new DeepSeekHarness({
      launch: {
        command: this.launch.command,
        args: this.launch.args,
        cwd,
      },
      cwd,
      provider: route.provider,
      model: route.model,
      ...(this.maxTokens === undefined ? {} : { maxTokens: this.maxTokens }),
    });
  }

  /**
   * Return the runtime entry for a cwd + model route, rebinding when the
   * requested route differs from the harness's fixed route. The dsh SDK
   * JSON-RPC protocol binds provider/model at session creation (initialize
   * handshake), so a hot model/provider switch requires re-spawning that
   * runtime. An in-use harness is NOT killed: it is retired and closed once
   * its last in-flight run settles, so parallel tasks are never interrupted
   * by a model switch.
   */
  private runtimeFor(cwd: string, route: ModelRoute): RuntimeEntry {
    if (this.disposed) {
      throw new Error('SdkDshAdapter is disposed');
    }
    const existing = this.runtimes.get(cwd);
    if (
      existing &&
      existing.provider === route.provider &&
      existing.model === route.model
    ) {
      return existing;
    }
    if (existing) {
      this.runtimes.delete(cwd);
      if (existing.active > 0) {
        existing.retired = true;
        this.draining.add(existing);
      } else {
        // Best-effort teardown; a failed close must not block the hot switch.
        void existing.harness.close().catch(() => undefined);
      }
    }
    const entry: RuntimeEntry = {
      harness: withRetryableStart(this.harnessFactory(cwd, route)),
      provider: route.provider,
      model: route.model,
      active: 0,
      retired: false,
    };
    this.runtimes.set(cwd, entry);
    return entry;
  }

  private releaseEntry(entry: RuntimeEntry): void {
    entry.active = Math.max(0, entry.active - 1);
    if (entry.retired && entry.active === 0) {
      this.draining.delete(entry);
      void entry.harness.close().catch(() => undefined);
    }
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
