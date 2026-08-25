import { log } from '../../core/logger.js';
import type { OutboundSink, SinkChannel, SinkMessage } from './types.js';
import { renderSinkText } from './text.js';

/**
 * 个人微信 (WeChat personal account) iLink bot sink — push-only.
 *
 * Contract (iLink bot API, see also `zhayujie/chatgpt-on-wechat` and
 * `lumpinif/agents-router`):
 *   `POST https://ilinkai.weixin.qq.com/ilink/bot/sendmessage`
 *   Authorization: Bearer <bot token>
 *   AuthorizationType: ilink_bot_token
 *   X-WECHAT-UIN: <random uin>
 *   iLink-App-Id: bot · iLink-App-ClientVersion: 131072
 *   body: { msg: { from_user_id:'', to_user_id, client_id:'', message_type:2,
 *            message_state:2, item_list:[{ type:1, text_item:{ text } }],
 *            context_token }, base_info:{ channel_version:1 } }
 *
 * ⚠️ This is a third-party "near-interactive" protocol with real compliance /
 * account-ban risk (the issue #113 research flagged it as an optional advanced
 * channel). It is implemented here because it is the only viable way to reach a
 * WeChat *personal* account from a push-only notification sink; the maintainer
 * must confirm the exact contract against the live endpoint before shipping.
 *
 * Channel encoding:
 *   - `destination` = `<to_user_id>|<context_token>` (the `|` splits them; the
 *     context token is per-bound-user and comes from `getupdates`).
 *   - `secret`      = the iLink bot access token (Bearer).
 */
export class WeChatIlinkSink implements OutboundSink {
  readonly type = 'wechat' as const;

  constructor(
    private readonly baseUrl = 'https://ilinkai.weixin.qq.com',
    private readonly randomUin: () => string = () => String(Math.floor(Math.random() * 1e9)),
  ) {}

  async send(channel: SinkChannel, message: SinkMessage): Promise<boolean> {
    const token = channel.secret;
    const [toUserId, contextToken] = splitDestination(channel.destination);
    if (!token || !toUserId || !contextToken) {
      log.warn('sink:wechat', 'missing-credential', { channel: channel.id });
      return false;
    }
    const url = `${this.baseUrl}/ilink/bot/sendmessage`;
    const body = JSON.stringify({
      msg: {
        from_user_id: '',
        to_user_id: toUserId,
        client_id: '',
        message_type: 2,
        message_state: 2,
        item_list: [{ type: 1, text_item: { text: renderSinkText(message) } }],
        context_token: contextToken,
      },
      base_info: { channel_version: 1 },
    });
    const headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      AuthorizationType: 'ilink_bot_token',
      'X-WECHAT-UIN': this.randomUin(),
      'iLink-App-Id': 'bot',
      'iLink-App-ClientVersion': '131072',
    };
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      timer.unref?.();
      const response = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });
      clearTimeout(timer);
      const payload = (await response.json().catch(() => ({}))) as { ret?: number; msg?: string; errmsg?: string };
      const ok = response.ok && (payload.ret === 0 || payload.ret === undefined);
      if (!ok) {
        log.warn('sink:wechat', 'send-failed', {
          channel: channel.id,
          error: payload.msg ?? payload.errmsg ?? `http ${response.status}`,
        });
        return false;
      }
      return true;
    } catch (error) {
      log.warn('sink:wechat', 'send-error', { channel: channel.id, error });
      return false;
    }
  }
}

/** Parse the `to_user_id` and `context_token` out of a wechat destination. */
export function splitDestination(value: string): [string, string] {
  const sep = value.indexOf('|');
  if (sep === -1) return [value, ''];
  return [value.slice(0, sep), value.slice(sep + 1)];
}
