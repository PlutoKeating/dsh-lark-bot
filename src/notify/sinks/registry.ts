import { log } from '../../core/logger.js';
import type { NotificationChannelStore } from './channel-store.js';
import { TelegramSink } from './telegram.js';
import { WeComSink } from './wecom.js';
import type { OutboundSink, SinkChannel, SinkMessage, SinkType } from './types.js';

export interface BroadcastSummary {
  /** Number of channels that acknowledged the notification. */
  delivered: number;
  /** Channel ids that failed (never the secret). */
  failures: string[];
  total: number;
}

/**
 * Builds and owns the concrete sink instances (mirror of the `AgentAdapter`
 * seam) and fans a notification out to every enabled, configured channel for a
 * scope. The Feishu path is not part of this registry: it stays the default
 * first-class route and remains wired through `NotificationDispatcher`.
 */
export class OutboundSinkRegistry {
  private readonly sinks: OutboundSink[];

  constructor(
    private readonly store: NotificationChannelStore,
    sinks: OutboundSink[] = [new TelegramSink(), new WeComSink()],
  ) {
    this.sinks = sinks;
  }

  /** Resolve only the enabled channels referenced by `channelIds`. */
  channelsForIds(channelIds: string[]): SinkChannel[] {
    const seen = new Set(channelIds);
    return this.store.list().filter((channel) => channel.enabled && seen.has(channel.id));
  }

  /** Channels currently enabled (for `/status` and `/channels`). */
  enabledChannels(): SinkChannel[] {
    return this.store.list().filter((channel) => channel.enabled);
  }

  /** Best-effort fan-out; a failing channel never blocks the others. */
  async broadcast(channelIds: string[], message: SinkMessage): Promise<BroadcastSummary> {
    const channelIdsToSend = [...new Set(channelIds)];
    const channels = this.channelsForIds(channelIdsToSend);
    const failures: string[] = [];
    let delivered = 0;
    for (const channel of channels) {
      const sink = this.sinkFor(channel.type);
      if (!sink) {
        log.warn('sinks', 'unsupported-type', { channel: channel.id, type: channel.type });
        failures.push(channel.id);
        continue;
      }
      let ok = false;
      try {
        ok = await sink.send(channel, message);
      } catch (error) {
        log.warn('sinks', 'channel-send-error', { channel: channel.id, error });
      }
      if (ok) delivered += 1;
      else failures.push(channel.id);
    }
    return { delivered, failures, total: channels.length };
  }

  private sinkFor(type: SinkType): OutboundSink | undefined {
    return this.sinks.find((sink) => sink.type === type);
  }
}
