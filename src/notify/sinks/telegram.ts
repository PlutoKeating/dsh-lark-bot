import { log } from '../../core/logger.js';
import { postJson } from './http.js';
import type { OutboundSink, SinkChannel, SinkMessage } from './types.js';
import { escapeHtml, renderSinkText } from './text.js';

/**
 * Telegram Bot API sink (official, stateless, push-only):
 * `POST https://api.telegram.org/bot<token>/sendMessage`.
 *
 * The chat_id (@handle or numeric id) is the channel destination and the bot
 * token is the channel secret. Sends `parse_mode=HTML` with the rendered text
 * HTML-escaped so titles/backticks do not render as raw symbols.
 */
export class TelegramSink implements OutboundSink {
  readonly type = 'telegram' as const;

  constructor(private readonly baseUrl = 'https://api.telegram.org') {}

  async send(channel: SinkChannel, message: SinkMessage): Promise<boolean> {
    const token = channel.secret;
    if (!token) {
      log.warn('sink:telegram', 'missing-token', { channel: channel.id });
      return false;
    }
    const url = `${this.baseUrl}/bot${encodeURIComponent(token)}/sendMessage`;
    const body = JSON.stringify({
      chat_id: channel.destination,
      text: escapeHtml(renderSinkText(message)),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
    try {
      const response = await postJson(url, body);
      const payload = (await response.json()) as { ok?: boolean; description?: string };
      if (!response.ok || payload.ok !== true) {
        log.warn('sink:telegram', 'send-failed', {
          channel: channel.id,
          error: payload.description ?? `http ${response.status}`,
        });
        return false;
      }
      return true;
    } catch (error) {
      log.warn('sink:telegram', 'send-error', { channel: channel.id, error });
      return false;
    }
  }
}
