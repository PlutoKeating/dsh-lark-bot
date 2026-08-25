import { log } from '../../core/logger.js';
import { postJson } from './http.js';
import type { OutboundSink, SinkChannel, SinkMessage } from './types.js';
import { renderSinkText } from './text.js';

/**
 * QQ 开放平台 (official bot) push-only sink.
 *
 * Contract:
 *  1. Access token  `POST https://bots.qq.com/app/getAppAccessToken`
 *     body `{ appId, clientSecret }` → `{ access_token }`.
 *  2. Send group msg `POST https://api.sgroup.qq.com/v2/groups/{group_openid}/messages`
 *     `Authorization: Bearer <access_token>`, `{ content, msg_type: 0 }`.
 *
 * Channel encoding:
 *   - `destination` = the target group `openid` (from the QR bind / admin setup).
 *   - `secret`      = `<app_id>:<client_secret>` (split on the first `:`).
 *
 * The QR bind flow (see `src/onboard/sink-qr.ts` qq provider) obtains the
 * `app_id` / `client_secret` from the QQ open-platform device-flow and the
 * target group `openid` from the scanner, mirroring the hermes-agent qqbot
 * onboarding.
 */
export class QqSink implements OutboundSink {
  readonly type = 'qq' as const;

  constructor(
    private readonly apiBase = 'https://api.sgroup.qq.com',
    private readonly fetchAccessToken: (appId: string, clientSecret: string) => Promise<string> = getAppAccessToken,
  ) {}

  async send(channel: SinkChannel, message: SinkMessage): Promise<boolean> {
    const [appId, clientSecret] = splitAppCredential(channel.secret);
    const groupOpenId = channel.destination;
    if (!appId || !clientSecret || !groupOpenId) {
      log.warn('sink:qq', 'missing-credential', { channel: channel.id });
      return false;
    }
    try {
      const token = await this.fetchAccessToken(appId, clientSecret);
      const url = `${this.apiBase}/v2/groups/${encodeURIComponent(groupOpenId)}/messages`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      timer.unref?.();
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: renderSinkText(message), msg_type: 0 }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const payload = (await response.json().catch(() => ({}))) as { code?: number; message?: string };
      if (!response.ok || (payload.code !== undefined && payload.code !== 0)) {
        log.warn('sink:qq', 'send-failed', {
          channel: channel.id,
          error: payload.message ?? `http ${response.status}`,
        });
        return false;
      }
      return true;
    } catch (error) {
      log.warn('sink:qq', 'send-error', { channel: channel.id, error });
      return false;
    }
  }
}

/** Split the `appId:clientSecret` compound secret. */
export function splitAppCredential(value: string): [string, string] {
  const sep = value.indexOf(':');
  if (sep === -1) return [value, ''];
  return [value.slice(0, sep), value.slice(sep + 1)];
}

async function getAppAccessToken(appId: string, clientSecret: string): Promise<string> {
  const response = await postJson(
    'https://bots.qq.com/app/getAppAccessToken',
    JSON.stringify({ appId, clientSecret }),
  );
  const payload = (await response.json()) as { access_token?: string; message?: string };
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.message ?? `access token http ${response.status}`);
  }
  return payload.access_token;
}
