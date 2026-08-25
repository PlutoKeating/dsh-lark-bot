import type { SinkType } from '../notify/sinks/types.js';

/**
 * Unified QR-scan onboarding for outbound notification sinks (issue #113).
 *
 * The goal: establishing ANY IM notification channel (WeChat / QQ priority,
 * Telegram / WhatsApp / DingTalk optional) requires only that the user scan a
 * QR code shown in the Feishu session. Each sink platform plugs in a
 * `SinkQrProvider` that knows how to (a) begin a bind session and produce a QR
 * value, and (b) poll that session until the user has scanned it and the
 * credentials are ready.
 */

export type SinkQrPhase = 'pending' | 'expired' | 'completed' | 'failed';

/** A bound session, including the QR value and its remaining validity. */
export interface SinkQrSession {
  providerType: SinkType;
  /** Opaque id that maps to the platform's device-flow session. */
  sessionId: string;
  /** The value to render into the QR image (a URL or a raw code). */
  qrUrl: string;
  /** Remaining validity in seconds. */
  expireIn: number;
}

/** The final credentials to persist as a `SinkChannel`. */
export interface SinkQrChannel {
  /** Stable id within a profile (admin chosen). */
  id: string;
  type: SinkType;
  label: string;
  destination: string;
  secret: string;
}

export interface SinkQrPoll {
  phase: SinkQrPhase;
  channel?: SinkQrChannel;
  error?: string;
}

export interface SinkQrProvider {
  readonly type: SinkType;
  /** Start a bind session and return the QR value to show the user. */
  begin(options?: { label?: string; id?: string }): Promise<SinkQrSession>;
  /** Poll the bind session; resolves once complete, expired or failed. */
  poll(sessionId: string, signal?: AbortSignal): Promise<SinkQrPoll>;
}

/** Registry of QR-bind providers, mirrored after the `OutboundSinkRegistry` seam. */
export class SinkQrRegistry {
  constructor(private readonly providers: SinkQrProvider[] = []) {}

  forType(type: SinkType): SinkQrProvider | undefined {
    return this.providers.find((provider) => provider.type === type);
  }

  has(type: SinkType): boolean {
    return this.forType(type) !== undefined;
  }

  supportedTypes(): SinkType[] {
    return this.providers.map((provider) => provider.type);
  }
}

export interface PollUntilOptions {
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Poll a provider until the bind completes, fails or expires — bounded by
 * `timeoutMs`. The caller is responsible for showing the QR while this runs
 * (the Feishu session gets the image out-of-band from this poll loop).
 */
export async function pollUntilCompleted(
  provider: SinkQrProvider,
  sessionId: string,
  options: PollUntilOptions = {},
): Promise<SinkQrPoll> {
  const interval = options.intervalMs ?? 3_000;
  const timeout = options.timeoutMs ?? 90_000;
  const signal = options.signal;
  const deadline = Date.now() + timeout;
  let last: SinkQrPoll = { phase: 'pending' };
  while (Date.now() < deadline) {
    if (signal?.aborted) return { phase: 'failed', error: 'aborted' };
    last = await provider.poll(sessionId, signal);
    if (last.phase !== 'pending') return last;
    await sleep(interval, signal);
  }
  return { phase: 'expired' };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(abortError());
      },
      { once: true },
    );
  });
}

function abortError(): Error {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}
