import { randomUUID } from 'node:crypto';
import type {
  AgentAdapter,
  AgentAvailability,
  AgentEvent,
  AgentRun,
  AgentRunOptions,
} from '../types.js';
import { EventChannel } from './event-channel.js';
import { translateSessionEvent } from './sdk-translate.js';

export interface WebAdapterOptions {
  /** Base URL of the local dsh web agent (default http://127.0.0.1:3080). */
  baseUrl?: string;
  provider: string;
  model: string;
}

/**
 * Strip the history preamble the bridge run-flow prepends and send only the
 * user's message: the web agent already resumes the full session itself, so
 * the transcript must not be embedded a second time.
 */
function extractUserText(prompt: string): string {
  const marker = 'Current user message:\n';
  const idx = prompt.lastIndexOf(marker);
  return idx === -1 ? prompt : prompt.slice(idx + marker.length);
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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

interface WebRunOptions {
  sessionId: string | undefined;
  prompt: string;
  cwd: string | undefined;
  model: string | undefined;
  stopRequested: { value: boolean };
  origin: AgentRunOptions['origin'];
}

interface WebRunHandle {
  events: AsyncIterable<AgentEvent>;
  settled: Promise<void>;
  stop: () => void;
}

function createWebRun(adapter: WebDshAdapter, options: WebRunOptions): WebRunHandle {
  const channel = new EventChannel<AgentEvent>();
  const tracker: { emitted: Set<string> } = { emitted: new Set() };
  const stopRequested = options.stopRequested;
  const turnEnded = deferred<void>();
  const sessionReady = deferred<{
    sessionId: string | undefined;
    cwd: string | undefined;
    model: string | undefined;
  }>();
  let hadError = false;
  let ws: WebSocket | undefined;
  let finished = false;

  const finish = (): void => {
    if (finished) return;
    finished = true;
    turnEnded.resolve();
  };

  const task = (async () => {
    try {
      // Resolve the target session (create a fresh one when the chat has none yet).
      let sessionId = options.sessionId;
      if (!sessionId) {
        const created = (await adapter.rpc('session.create', { cwd: options.cwd })) as {
          result?: {
            ok: boolean;
            value?: { sessionId?: string };
            error?: { message?: string };
          };
        };
        if (!created?.result?.ok) {
          throw new Error(created?.result?.error?.message ?? 'web session.create failed');
        }
        sessionId = created.result.value?.sessionId;
      }
      if (sessionId === undefined) {
        throw new Error('web session id unresolved');
      }
      sessionReady.resolve({ sessionId, cwd: options.cwd, model: options.model });

      // Open the mux event stream (the web server broadcasts every session's
      // events to every connection; filter by our session id).
      ws = await adapter.openMux();
      const onMessage = (event: { data: unknown }): void => {
        let full: unknown;
        try {
          full = JSON.parse(String(event.data));
        } catch {
          return;
        }
        const frame = (full as { payload?: Record<string, unknown> })?.payload;
        if (!frame || typeof frame.type !== 'string') return;
        if (frame.type === 'session/event' && frame.sessionId === sessionId) {
          for (const translated of translateSessionEvent(frame.event, tracker)) {
            if (translated.type === 'error') hadError = true;
            channel.push(translated);
          }
          const ev = frame.event as { type?: string; seq?: number };
          if (ev?.type === 'turn/end') {
            finish();
          }
        } else if (frame.type === 'stream/error') {
          hadError = true;
          channel.push({
            type: 'error',
            message:
              (frame.error as { message?: string } | undefined)?.message ??
              'web mux stream error',
            terminationReason: 'failed',
          });
          finish();
        }
      };
      ws.addEventListener('message', onMessage);
      ws.addEventListener('close', () => finish(), { once: true });

      // Send the user message; the web agent already holds the full history.
      const promptRpcId = randomUUID();
      await adapter.recordPromptCorrelation(sessionId, promptRpcId, options.origin);
      const promptResult = (await adapter.rpc('session.prompt', {
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: extractUserText(options.prompt) }],
      }, promptRpcId)) as { result?: { ok: boolean; error?: { message?: string } } };
      if (!promptResult?.result?.ok) {
        throw new Error(promptResult?.result?.error?.message ?? 'web session.prompt failed');
      }

      // Wait for the turn to finish (or for stop).
      await new Promise<void>((resolve) => {
        void turnEnded.promise.then(() => resolve());
        const timer = setInterval(() => {
          if (stopRequested.value) {
            clearInterval(timer);
            resolve();
          }
        }, 250);
        void turnEnded.promise.finally(() => clearInterval(timer));
      });
      ws.removeEventListener('message', onMessage);
    } catch (error) {
      sessionReady.resolve({
        sessionId: options.sessionId,
        cwd: options.cwd,
        model: options.model,
      });
      if (!stopRequested.value) {
        hadError = true;
        channel.push({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
          terminationReason: 'failed',
        });
      }
    } finally {
      finish();
      try {
        ws?.close();
      } catch {
        // ignore
      }
      channel.close();
    }
  })();

  async function* events(): AsyncGenerator<AgentEvent> {
    const info = await sessionReady.promise;
    yield { type: 'system', sessionId: info.sessionId, cwd: info.cwd, model: info.model };
    for await (const event of channel) yield event;
    await task;
    if (!hadError) {
      yield {
        type: 'done',
        sessionId: info.sessionId,
        terminationReason: stopRequested.value ? 'interrupted' : 'normal',
      };
    }
  }

  return {
    events: events(),
    settled: task.then(() => undefined),
    stop: (): void => {
      stopRequested.value = true;
      finish();
      try {
        ws?.close();
      } catch {
        // ignore
      }
    },
  };
}

/**
 * `web` adapter: drive the local dsh web agent through its HTTP API
 * (`session.create` / `session.prompt`) and its WebSocket event stream
 * (`/api/events.mux`). The web agent is the single writer of every session
 * log, which removes the multi-writer corruption (double-write) that any
 * second agent runtime (SDK subprocess, guardian relaunch, stale live
 * session) can cause, and gives cross-instance history continuation for free.
 */
export class WebDshAdapter implements AgentAdapter {
  readonly id = 'dsh-web';
  readonly displayName = 'DeepSeek Harness (Web GUI)';
  /**
   * The web agent is the single writer of each session log and holds sessions
   * server-side across connections, so `run()` natively resumes the session
   * identified by `options.sessionId` (the run-flow only replays the bridge
   * transcript for adapters that cannot resume).
   */
  readonly resumeCapable = true;

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly sockets = new Set<WebSocket>();
  private disposed = false;
  private promptObserver: ((input: {
    sessionId: string;
    rpcId: string;
    origin: NonNullable<AgentRunOptions['origin']>;
  }) => Promise<void>) | undefined;

  constructor(options: WebAdapterOptions) {
    this.baseUrl = (options.baseUrl ?? 'http://127.0.0.1:3080').replace(/\/+$/, '');
    this.model = options.model;
  }

  setPromptObserver(observer: ((input: {
    sessionId: string;
    rpcId: string;
    origin: NonNullable<AgentRunOptions['origin']>;
  }) => Promise<void>) | undefined): void {
    this.promptObserver = observer;
  }

  async recordPromptCorrelation(
    sessionId: string,
    rpcId: string,
    origin: AgentRunOptions['origin'],
  ): Promise<void> {
    if (origin) await this.promptObserver?.({ sessionId, rpcId, origin });
  }

  async rpc<T = unknown>(method: string, payload: unknown, rpcId = randomUUID()): Promise<T> {
    const response = await fetch(`${this.baseUrl}/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`web RPC ${method} failed: HTTP ${response.status}`);
    return response.json() as Promise<T>;
  }

  async openMux(): Promise<WebSocket> {
    const url = `${this.baseUrl.replace(/^http/, 'ws')}/api/events.mux`;
    const socket = new WebSocket(url);
    this.sockets.add(socket);
    socket.addEventListener('close', () => this.sockets.delete(socket), { once: true });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('web mux websocket open timed out')),
        15_000,
      );
      socket.addEventListener(
        'open',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        'error',
        () => {
          clearTimeout(timer);
          reject(new Error('web mux websocket connection failed'));
        },
        { once: true },
      );
    });
    return socket;
  }

  /**
   * Whether this live adapter instance can still resume the named native
   * session. The web server is the session's single writer, and a freshly
   * constructed adapter is reconnected to the same web server after a bridge
   * restart, so the only case where resume is denied is once the adapter has
   * been disposed (bridge shutdown). An unknown/expired session id is handled
   * by the run-flow fallback rather than here.
   */
  canResume(_options: {
    runtimeKey?: string;
    cwd: string | undefined;
    sessionId: string;
    provider?: string;
    model: string | undefined;
  }): boolean {
    return !this.disposed;
  }

  async isAvailable(): Promise<boolean> {
    return (await this.checkAvailability()).ok;
  }

  async checkAvailability(): Promise<AgentAvailability> {
    if (this.disposed) {
      return { ok: false, error: 'adapter disposed', version: undefined };
    }
    try {
      const response = await fetch(`${this.baseUrl}/`, {
        method: 'GET',
        signal: AbortSignal.timeout(5_000),
      });
      return response.ok
        ? { ok: true, error: undefined, version: `dsh-web@${this.baseUrl}` }
        : { ok: false, error: `HTTP ${response.status}`, version: undefined };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        version: undefined,
      };
    }
  }

  run(options: AgentRunOptions): AgentRun {
    const cwd = options.cwd ?? process.cwd();
    const handle = createWebRun(this, {
      sessionId: options.sessionId,
      prompt: options.prompt,
      cwd,
      model: options.model ?? this.model,
      stopRequested: { value: false },
      origin: options.origin,
    });
    return {
      runId: options.runId,
      events: handle.events,
      stop: async (): Promise<void> => {
        handle.stop();
        await handle.settled;
      },
      waitForExit: (timeoutMs: number) => waitWithTimeout(handle.settled, timeoutMs),
    };
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    for (const socket of this.sockets) {
      try {
        socket.close();
      } catch {
        // ignore
      }
    }
    this.sockets.clear();
  }
}
