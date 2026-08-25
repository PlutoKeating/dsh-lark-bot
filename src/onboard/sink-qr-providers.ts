import { createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import type {
  SinkQrChannel,
  SinkQrPoll,
  SinkQrProvider,
  SinkQrSession,
} from './sink-qr.js';
import type { SinkType } from '../notify/sinks/types.js';
import { splitDestination } from '../notify/sinks/wechat.js';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const API_HEADERS = { 'content-type': 'application/json', accept: 'application/json' };

// ── QQ 开放平台 (official bot) QR bind ───────────────────────────────────────
// Verified contract mirrors NousResearch/hermes-agent
// `gateway/platforms/qqbot/onboard.py` (create_bind_task → poll_bind_result →
// local AES-256-GCM decrypt of client_secret). QR target encodes the task id.

const BIND_STATUS = { NONE: 0, PENDING: 1, COMPLETED: 2, EXPIRED: 3 } as const;

interface QqSession {
  taskId: string;
  aesKey: string;
}

export class QqQrProvider implements SinkQrProvider {
  readonly type: SinkType = 'qq';
  private readonly sessions = new Map<string, QqSession>();

  constructor(
    private readonly portalHost = process.env.DSH_LARK_QQ_PORTAL_HOST ?? 'q.qq.com',
    private readonly fetchImpl: FetchLike = fetch,
    private readonly genKey: () => string = () => randomBytes(32).toString('base64'),
  ) {}

  async begin(_options?: { label?: string; id?: string }): Promise<SinkQrSession> {
    const aesKey = this.genKey();
    const response = await this.fetchImpl(`https://${this.portalHost}/lite/create_bind_task`, {
      method: 'POST',
      headers: API_HEADERS,
      body: JSON.stringify({ key: aesKey }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      retcode?: number;
      msg?: string;
      data?: { task_id?: string; aes_key?: string };
    };
    const taskId = payload.data?.task_id;
    if (!response.ok || !taskId || (payload.retcode !== undefined && payload.retcode !== 0)) {
      throw new Error(`qq create_bind_task failed: ${payload.msg ?? ''} (http ${response.status})`);
    }
    const sessionId = randomUUID();
    this.sessions.set(sessionId, { taskId, aesKey });
    const qrUrl =
      `https://q.qq.com/qqbot/openclaw/connect.html?task_id=${encodeURIComponent(taskId)}` +
      '&_wv=2&source=dsh-lark-bot';
    return { providerType: this.type, sessionId, qrUrl, expireIn: 600 };
  }

  async poll(sessionId: string, _signal?: AbortSignal): Promise<SinkQrPoll> {
    const state = this.sessions.get(sessionId);
    if (!state) return { phase: 'failed', error: 'unknown session' };
    let data: { status?: number; bot_appid?: string; bot_encrypt_secret?: string; user_openid?: string } = {};
    try {
      const response = await this.fetchImpl(`https://${this.portalHost}/lite/poll_bind_result`, {
        method: 'POST',
        headers: API_HEADERS,
        body: JSON.stringify({ task_id: state.taskId }),
      });
      const payload = (await response.json()) as { retcode?: number; msg?: string; data?: typeof data };
      if (!response.ok || (payload.retcode !== undefined && payload.retcode !== 0)) return { phase: 'pending' };
      data = payload.data ?? {};
    } catch {
      return { phase: 'pending' };
    }
    const status = data.status ?? BIND_STATUS.NONE;
    if (status === BIND_STATUS.COMPLETED && data.bot_appid && data.bot_encrypt_secret) {
      let clientSecret: string;
      try {
        clientSecret = decryptSecret(data.bot_encrypt_secret, state.aesKey);
      } catch (error) {
        this.sessions.delete(sessionId);
        return { phase: 'failed', error: `decrypt failed: ${error instanceof Error ? error.message : String(error)}` };
      }
      const target = data.user_openid ? `user:${data.user_openid}` : '';
      this.sessions.delete(sessionId);
      return {
        phase: 'completed',
        channel: {
          id: '',
          type: 'qq',
          label: 'QQ',
          destination: target,
          secret: `${data.bot_appid}:${clientSecret}`,
        },
      };
    }
    if (status === BIND_STATUS.EXPIRED) {
      this.sessions.delete(sessionId);
      return { phase: 'expired' };
    }
    return { phase: 'pending' };
  }
}

// ── 微信个人号 (WeChat personal) iLink QR bind ──────────────────────────────
// Mirrors chatgpt-on-wechat `channel/weixin/weixin_api.py`:
//   fetch_qr_code(): GET  /ilink/bot/get_bot_qrcode?bot_type=3
//   poll_qr_status(): GET /ilink/bot/get_qrcode_status?qrcode=<urlencoded>
// ⚠️ iLink is a third-party protocol with no official spec; the "scan confirmed →
// bot token / bound user" field names below are inferred from the reference
// community client and MUST be confirmed against a live scan by the maintainer.
// The QR display path and `/channels accept` manual fallback remain available.

interface WeChatSession {
  qrcode: string;
}

export class WeChatQrProvider implements SinkQrProvider {
  readonly type: SinkType = 'wechat';
  private readonly sessions = new Map<string, WeChatSession>();

  constructor(
    private readonly baseUrl = process.env.DSH_LARK_WECHAT_ILINK_URL ?? 'https://ilinkai.weixin.qq.com',
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async begin(_options?: { label?: string; id?: string }): Promise<SinkQrSession> {
    const response = await this.fetchImpl(`${this.baseUrl}/ilink/bot/get_bot_qrcode?bot_type=3`, {
      method: 'GET',
    });
    const payload = (await response.json().catch(() => ({}))) as {
      qrcode?: string;
      url?: string;
      ret?: number;
      msg?: string;
    };
    const qrcode = payload.qrcode ?? payload.url ?? '';
    if (!response.ok || !qrcode) {
      throw new Error(payload.msg ?? `wechat get_bot_qrcode failed: http ${response.status}`);
    }
    const sessionId = randomUUID();
    this.sessions.set(sessionId, { qrcode });
    return { providerType: this.type, sessionId, qrUrl: qrcode, expireIn: 180 };
  }

  async poll(sessionId: string, _signal?: AbortSignal): Promise<SinkQrPoll> {
    const state = this.sessions.get(sessionId);
    if (!state) return { phase: 'failed', error: 'unknown session' };
    const statusUrl = `${this.baseUrl}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(state.qrcode)}`;
    try {
      const response = await this.fetchImpl(statusUrl, {
        method: 'GET',
        headers: { 'iLink-App-Id': 'bot', 'iLink-App-ClientVersion': '131072' },
      });
      const payload = (await response.json().catch(() => ({}))) as {
        status?: string | number;
        token?: string;
        access_token?: string;
        openid?: string;
        user_id?: string;
        to_user_id?: string;
      };
      const status = String(payload.status ?? 'wait').toLowerCase();
      if (status === 'confirmed' || status === 'success' || status === 'scanned' || status === '2') {
        const token = payload.token ?? payload.access_token ?? '';
        const userId = payload.openid ?? payload.user_id ?? payload.to_user_id ?? '';
        this.sessions.delete(sessionId);
        return {
          phase: 'completed',
          channel: { id: '', type: 'wechat', label: '微信', destination: userId ? `${userId}|` : '', secret: token },
        };
      }
      if (status === 'expired') {
        this.sessions.delete(sessionId);
        return { phase: 'expired' };
      }
      return { phase: 'pending' };
    } catch {
      return { phase: 'pending' };
    }
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

function normalizeWechatDestination(value: string): string {
  if (value.includes('|')) return value;
  const [id] = splitDestination(value);
  return id ? `${id}|` : value;
}

/** AES-256-GCM decrypt: base64(key) → base64( IV(12) ‖ CT ‖ tag(16) ). */
export function decryptSecret(encryptedBase64: string, keyBase64: string): string {
  const key = Buffer.from(keyBase64, 'base64');
  const raw = Buffer.from(encryptedBase64, 'base64');
  if (key.length !== 32) throw new Error('bind key must be 32 bytes');
  if (raw.length < 12 + 16) throw new Error('ciphertext too short');
  const iv = raw.subarray(0, 12);
  const body = raw.subarray(12);
  const tag = body.subarray(body.length - 16);
  const ciphertext = body.subarray(0, body.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
