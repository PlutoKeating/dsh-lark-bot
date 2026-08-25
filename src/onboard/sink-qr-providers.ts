import type {
  SinkQrChannel,
  SinkQrPoll,
  SinkQrProvider,
  SinkQrSession,
} from './sink-qr.js';
import type { SinkType } from '../notify/sinks/types.js';
import { splitDestination } from '../notify/sinks/wechat.js';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * WeChat (iLink) QR bind provider.
 *
 * ⚠️ iLink is a third-party "near-interactive" protocol (see the sink module
 * docs): the QR comes from `ilink/bot/get_bot_qrcode` and the per-user
 * `context_token` from `ilink/bot/getupdates`. Both endpoints and the exact
 * response shape MUST be verified against the live endpoint by the maintainer
 * before relying on this provider; the `/channels add --qr` flow falls back to
 * manual entry when the provider cannot complete.
 */
export class WeChatQrProvider implements SinkQrProvider {
  readonly type: SinkType = 'wechat';

  constructor(
    private readonly baseUrl = process.env.DSH_LARK_WECHAT_ILINK_URL ?? 'https://ilinkai.weixin.qq.com',
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async begin(_options?: { label?: string; id?: string }): Promise<SinkQrSession> {
    const response = await this.fetchImpl(`${this.baseUrl}/ilink/bot/get_bot_qrcode`, { method: 'POST' });
    const payload = (await response.json().catch(() => ({}))) as {
      qrcode?: string;
      url?: string;
      ret?: number;
      msg?: string;
    };
    const qrUrl = payload.qrcode ?? payload.url ?? '';
    if (!response.ok || !qrUrl) {
      throw new Error(payload.msg ?? `wechat get_bot_qrcode failed: http ${response.status}`);
    }
    return { providerType: this.type, sessionId: qrUrl, qrUrl, expireIn: 180 };
  }

  async poll(sessionId: string, _signal?: AbortSignal): Promise<SinkQrPoll> {
    // A single `getupdates` returns nothing until a user has scanned and the
    // bot token / context token are ready. Without a verified contract we cannot
    // distinguish "still pending" from "bound" here, so this provider returns
    // `pending` and the caller falls back to manual entry after the timeout.
    const response = await this.fetchImpl(`${this.baseUrl}/ilink/bot/getupdates`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ qrcode: sessionId }),
    }).catch(() => undefined);
    void response;
    return { phase: 'pending' };
  }
}

/**
 * QQ 开放平台 (official bot) QR bind provider, mirroring the hermes-agent
 * `gateway/platforms/qqbot/onboard.py` flow: `create_bind_task` returns a
 * task id + AES bind key, the QR encodes a template URL, and
 * `poll_bind_result` returns the bound `app_id` / `client_secret` (locally
 * decrypted) plus the scanner's `user_openid`.
 *
 * ⚠️ The AES key/decryption contract and the exact QR URL template must be
 * verified against the live QQ open-platform before relying on this provider;
 * the `/channels add --qr` flow falls back to manual entry otherwise.
 */
export class QqQrProvider implements SinkQrProvider {
  readonly type: SinkType = 'qq';

  constructor(
    private readonly portalHost = process.env.DSH_LARK_QQ_PORTAL_HOST ?? 'api.sgroup.qq.com',
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async begin(_options?: { label?: string; id?: string }): Promise<SinkQrSession> {
    const response = await this.fetchImpl(`https://${this.portalHost}/app/create_bind_task`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      retcode?: number;
      data?: { task_id?: string; aes_key?: string };
    };
    const taskId = payload.data?.task_id;
    if (!response.ok || !taskId || (payload.retcode !== undefined && payload.retcode !== 0)) {
      throw new Error(`qq create_bind_task failed: http ${response.status}`);
    }
    const qrUrl = `https://q.qq.com/bot/#/bind-task?key=${encodeURIComponent(taskId)}`;
    return { providerType: this.type, sessionId: taskId, qrUrl, expireIn: 180 };
  }

  async poll(sessionId: string, _signal?: AbortSignal): Promise<SinkQrPoll> {
    // `poll_bind_result` decrypts the returned `client_secret` with the bind key
    // captured at `begin` time; without the agreed decryption contract we cannot
    // finalize here, so this provider reports pending and the caller falls back
    // to manual entry (the user supplies the target group openid + app secret).
    const response = await this.fetchImpl(`https://${this.portalHost}/app/poll_bind_result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task_id: sessionId }),
    }).catch(() => undefined);
    void response;
    return { phase: 'pending' };
  }
}

/** Build the deploy-time registry of QR-bind providers. */
export function buildSinkQrProviders(): SinkQrProvider[] {
  return [new WeChatQrProvider(), new QqQrProvider()];
}

/** Validate & shape a manual/auto-provided channel into a normalised result. */
export function coerceSinkQrChannel(input: {
  id: string;
  type: SinkType;
  label: string;
  destination: string;
  secret: string;
}): SinkQrChannel {
  const destination = input.type === 'wechat' ? normalizeWechatDestination(input.destination) : input.destination;
  return { id: input.id, type: input.type, label: input.label, destination, secret: input.secret };
}

/**
 * WeChat destinations are encoded as `<to_user_id>|<context_token>`; when only
 * one part is provided, keep it verbatim so the sink can still function if the
 * context token is supplied separately.
 */
function normalizeWechatDestination(value: string): string {
  if (value.includes('|')) return value;
  return splitDestination(value)[0] ? `${value}|` : value;
}
