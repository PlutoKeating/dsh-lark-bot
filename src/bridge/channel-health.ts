import type { LarkChannel, WSConnectionState, WSConnectionStatus } from '@larksuite/channel';

/**
 * Channel readiness, distinct from engine liveness.
 *
 * Issue #108: a Feishu WebSocket can become a half-open connection — the TCP
 * socket stays `ESTABLISHED` and the bridge engine keeps writing a fresh
 * heartbeat, but Feishu stops delivering inbound events. The engine's own
 * heartbeat only proves the *process* is alive, so `service status`, `doctor`
 * and the guardian all kept reporting healthy while messages were silently
 * lost.
 *
 * This monitor reads the SDK's connection-state snapshot (`getConnectionStatus`)
 * and tracks generation / reconnect / inbound metadata so callers can tell
 * "engine alive" apart from "channel ready". It is driven by the same events
 * the bridge already subscribes to (`reconnecting`, `reconnected`, `error`,
 * `message`), so it needs no second subscription to the SDK.
 */

export type ChannelReadyState =
  | 'connecting'
  | 'ready'
  | 'reconnecting'
  | 'failed'
  | 'stopped';

export interface ChannelHealth {
  /** High-level channel readiness. */
  state: ChannelReadyState;
  /** True only when the channel is actively delivering (`state === 'ready'`). */
  ready: boolean;
  /**
   * Connection generation. Incremented every time a *fresh* WebSocket
   * connection is established, so callers can fence late events out of the
   * current generation.
   */
  generation: number;
  /** Timestamp (ms) of the current generation's successful connect, if any. */
  connectedAt?: number;
  /** Consecutive reconnect attempts in the current loop (from the SDK). */
  reconnectAttempts: number;
  /** Timestamp (ms) of the last inbound message actually dispatched by the bridge. */
  lastInboundAt?: number;
  /** Timestamp (ms) of the last successful (re)connect. */
  lastReconnectAt?: number;
  /** Last transport error surfaced by the SDK, if any. */
  lastError?: string;
  /** Snapshot time (ms). */
  at: number;
}

export interface ChannelHealthMonitorOptions {
  /** Poll cadence for reading the underlying WS connection status. Default 5s. */
  pollMs?: number;
  /** Invoked with a new snapshot whenever the observable state changes. */
  onUpdate?: (health: ChannelHealth) => void;
}

function mapState(state: WSConnectionState | undefined): ChannelReadyState {
  switch (state) {
    case 'connected':
      return 'ready';
    case 'reconnecting':
      return 'reconnecting';
    case 'failed':
      return 'failed';
    case 'connecting':
      return 'connecting';
    case 'idle':
    default:
      return 'connecting';
  }
}

export class ChannelHealthMonitor {
  private readonly channel: LarkChannel;
  private readonly pollMs: number;
  private readonly onUpdate: ((health: ChannelHealth) => void) | undefined;

  private generation = 0;
  private connectedAt?: number;
  private lastInboundAt?: number;
  private lastReconnectAt?: number;
  private lastError?: string;
  private observedState: ChannelReadyState = 'connecting';
  private reconnectAttempts = 0;
  private at = 0;

  private pollTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    channel: LarkChannel,
    options: ChannelHealthMonitorOptions = {},
  ) {
    this.channel = channel;
    this.pollMs = options.pollMs ?? 5_000;
    this.onUpdate = options.onUpdate;
  }

  /** Latest snapshot (always a copy; safe to persist). */
  snapshot(): ChannelHealth {
    return {
      state: this.observedState,
      ready: this.observedState === 'ready',
      generation: this.generation,
      ...(this.connectedAt !== undefined ? { connectedAt: this.connectedAt } : {}),
      reconnectAttempts: this.reconnectAttempts,
      ...(this.lastInboundAt !== undefined ? { lastInboundAt: this.lastInboundAt } : {}),
      ...(this.lastReconnectAt !== undefined ? { lastReconnectAt: this.lastReconnectAt } : {}),
      ...(this.lastError !== undefined ? { lastError: this.lastError } : {}),
      at: this.at,
    };
  }

  /** Bind transport hooks from the bridge event subscription. */
  observeMessage(): void {
    this.lastInboundAt = Date.now();
    this.markChanged();
  }

  observeReconnecting(): void {
    this.observedState = 'reconnecting';
    this.markChanged();
  }

  observeReconnected(): void {
    this.generation += 1;
    const now = Date.now();
    this.connectedAt = now;
    this.lastReconnectAt = now;
    this.observedState = 'ready';
    this.markChanged();
  }

  observeError(error: unknown): void {
    this.lastError = error instanceof Error ? error.message : String(error);
    if (this.observedState !== 'reconnecting' && this.observedState !== 'failed') {
      this.observedState = 'failed';
    }
    this.markChanged();
  }

  /** Poll the SDK's connection-status snapshot. */
  start(): void {
    if (this.pollTimer) return;
    this.refresh();
    this.pollTimer = setInterval(() => this.refresh(), this.pollMs);
    this.pollTimer.unref?.();
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    this.observedState = 'stopped';
    this.markChanged();
  }

  private refresh(): void {
    const status: WSConnectionStatus | undefined = this.channel.getConnectionStatus?.();
    this.observedState = mapState(status?.state);
    this.reconnectAttempts = status?.reconnectAttempts ?? this.reconnectAttempts;
    // `connectedAt` / generation are authoritative from the reconnected hook;
    // the SDK does not expose connect timestamps that are more trustworthy here.
    this.markChanged();
  }

  private markChanged(): void {
    const now = Date.now();
    this.at = now;
    this.onUpdate?.(this.snapshot());
  }
}
