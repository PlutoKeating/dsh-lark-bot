import { log } from '../../core/logger.js';
import { postJson } from './http.js';
import type { OutboundSink, SinkChannel, SinkMessage } from './types.js';
import { renderSinkText } from './text.js';

/**
 * 企业微信 (WeCom) group-robot webhook sink:
 * `POST https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=<key>`.
 *
 * The webhook key is the channel destination (and its mirrored `secret`), and
 * is the only credential the bridge needs. Sends `msgtype=text` (markdown
 * support on group robots is limited, so plain text is the robust default).
 */
export class WeComSink implements OutboundSink {
  readonly type = 'wecom' as const;

  constructor(private readonly baseUrl = 'https://qyapi.weixin.qq.com') {}

  async send(channel: SinkChannel, message: SinkMessage): Promise<boolean> {
    const key = channel.destination;
    if (!key) {
      log.warn('sink:wecom', 'missing-key', { channel: channel.id });
      return false;
    }
    const url = `${this.baseUrl}/cgi-bin/webhook/send?key=${encodeURIComponent(key)}`;
    const body = JSON.stringify({
      msgtype: 'text',
      text: { content: renderSinkText(message) },
    });
    try {
      const response = await postJson(url, body);
      const payload = (await response.json()) as { errcode?: number; errmsg?: string };
      if (!response.ok || payload.errcode !== 0) {
        log.warn('sink:wecom', 'send-failed', {
          channel: channel.id,
          error: payload.errmsg ?? `http ${response.status}`,
        });
        return false;
      }
      return true;
    } catch (error) {
      log.warn('sink:wecom', 'send-error', { channel: channel.id, error });
      return false;
    }
  }
}
