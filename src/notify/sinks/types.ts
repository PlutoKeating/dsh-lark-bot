import type { NotificationEvent } from '../../bot/notification-preference-store.js';

/** Supported outbound notification-only sink platforms. */
export type SinkType = 'telegram' | 'wecom';

/**
 * A configured outbound notification channel. The bridge is the only consumer
 * of these entries; each channel is a notification-only sink (no inbound).
 *
 * Secrets (telegram bot token / wecom webhook key) live in
 * `<profile>/notification-channels.json` written at mode 0600 and must never
 * appear in logs, cards, diagnostics or channel output. `mask()` is the single
 * place that renders a safe, non-echoing description.
 */
export interface SinkChannel {
  /** Stable channel id, unique within a profile (admin chosen). */
  id: string;
  type: SinkType;
  /** Human-facing label shown by `/channels` and `/status`. */
  label: string;
  /**
   * Platform destination:
   * - telegram: target chat_id / @handle that messages are sent to.
   * - wecom   : the webhook key (the value after `?key=`).
   */
  destination: string;
  /**
   * Secret credential:
   * - telegram: the bot token (`<bot_id>:<secret>`).
   * - wecom   : the webhook key (kept mirrored from `destination` so a single
   *   redaction helper always covers the credential; only ever read by the
   *   sink itself, never logged).
   */
  secret: string;
  enabled: boolean;
  /** Optional feishu user_id -> platform user id mapping for mentions. */
  mentionMap?: Record<string, string>;
}

/** A rendered notification delivered to sinks, independent of any Feishu routing. */
export interface SinkMessage {
  /** Immutable bridge scope that produced the event. */
  scope: string;
  event: NotificationEvent;
  /** Localized title (zh_cn / en_us) as the sink content headline. */
  title: { zh: string; en: string };
  /** Optional free-form detail appended to the headline. */
  detail?: string;
}

/** An outbound notification sink (mirrors the `AgentAdapter` pluggable seam). */
export interface OutboundSink {
  readonly type: SinkType;
  /**
   * Deliver one notification. Must resolve to `false` — not throw — on a
   * transport failure so the dispatcher can keep fanning out to the remaining
   * channels without corrupting the Feishu terminal state.
   */
  send(channel: SinkChannel, message: SinkMessage): Promise<boolean>;
}

/** Sensible default HTTP timeout for outbound notifications (ms). */
export const SINK_HTTP_TIMEOUT_MS = 10_000;

/** Build a stable display string for a channel that conceals the credential. */
export function maskChannel(channel: SinkChannel, includeId = true): string {
  const id = includeId ? `${channel.id} · ` : '';
  const dest = maskSecret(channel.destination);
  return `${id}${channel.type} · ${channel.label} → ${dest}`;
}

/** Conceal a credential, keeping only a short non-secret suffix for traceability. */
export function maskSecret(value: string): string {
  if (!value) return '(unset)';
  if (value.length <= 6) return `${value[0]}{redacted}`;
  return `${value.slice(0, 3)}…${value.slice(-3)}`;
}
