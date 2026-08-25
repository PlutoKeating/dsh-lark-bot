import { randomBytes } from 'node:crypto';

/**
 * Feishu Open Platform automation for a bound app (issue #113 onboarding, plan
 * A4). After the `@larksuiteoapi/node-sdk` device flow creates a PersonalAgent
 * app and yields `appId`/`appSecret`, a second, app-admin-authenticated pass can
 * (a) bind the WebSocket event subscription, (b) import the `im:*` permission
 * scopes and (c) create + submit a release version — so the bot is truly usable
 * (including group `@`) out of the box.
 *
 * ⚠️ Feishu's permission import and, especially, version review/publishing are
 * partly manual console actions; the public API support is limited and the exact
 * contracts below MUST be verified against the live Open Platform by the
 * maintainer. All helper functions therefore degrade to a "manual step" result
 * rather than pretending success. `adminLoginUrl()` is the real entry point that
 * opens the Open Platform authorization for the app admin.
 */

export interface BootstrapInput {
  appId: string;
  appSecret: string;
  tenant?: 'feishu' | 'lark';
}

export interface BootstrapOutcome {
  ok: boolean;
  /**
   * Human-readable manual instructions to run when the automated step could not
   * complete (or, for `submitVersion`, because review is inherently manual).
   */
  manualSteps?: string;
  detail?: string;
}

const OPEN_PLATFORM_BASE = {
  feishu: 'https://open.feishu.cn',
  lark: 'https://open.larkoffice.com',
} as const;

/** The `im:*` scopes a Feishu personal-agent notification bridge needs. */
export const REQUIRED_IM_SCOPES = [
  'im:message',
  'im:message.group_at_msg',
  'im:message.send_as_bot',
  'im:message.p2p_msg:readonly',
  'im:chat:readonly',
] as const;

/**
 * Build the Open Platform authorization URL an app admin opens in a browser to
 * grant the bridge a user access token with app-management permission. Redirect
 * to `redirectUri` (e.g. the localhost bootstrap callback) to receive `code`.
 */
export function adminLoginUrl(input: Pick<BootstrapInput, 'appId' | 'tenant'>, redirectUri: string): string {
  const base = OPEN_PLATFORM_BASE[input.tenant ?? 'feishu'];
  const state = randomBytes(16).toString('hex');
  const params = new URLSearchParams({
    app_id: input.appId,
    redirect_uri: redirectUri,
    state,
    scope: 'application:application',
  });
  return `${base}/open-apis/authen/v1/authorize?${params.toString()}`;
}

/** Ensure the app subscribes to events over a WebSocket long connection. */
export async function ensureEventSubscription(
  _input: BootstrapInput,
  _userToken: string,
): Promise<BootstrapOutcome> {
  return {
    ok: false,
    manualSteps:
      `在飞书开放平台「应用 → 事件与回调」中，订阅方式选择「使用长连接接收事件」(WebSocket)，` +
      `并订阅 \`im.message.receive_v1\` + \`card.action.trigger\`；然后启动本 bot 建立长连接。`,
    detail: 'automated event-subscription patch requires maintainer contract verification',
  };
}

/** Import the `im:*` permission scopes the bridge needs. */
export async function importScopes(
  input: BootstrapInput,
  _userToken: string,
  scopes: readonly string[] = REQUIRED_IM_SCOPES,
): Promise<BootstrapOutcome> {
  return {
    ok: false,
    manualSteps:
      `在飞书开放平台「应用 → 权限管理」中为 \`${input.appId}\` 申请：\n` +
      scopes.map((scope) => `  - \`${scope}\``).join('\n') +
      '\n（个人自建应用通常免审批，可即时生效；若用于群聊请确认已勾选群消息接收权限。）',
    detail: 'automated permission import requires maintainer contract verification',
  };
}

/** Create a release version and submit it for review/publish. */
export async function submitVersion(
  _input: BootstrapInput,
  _userToken: string,
  version: { name: string; description: string },
): Promise<BootstrapOutcome> {
  return {
    ok: false,
    manualSteps:
      `在飞书开放平台「应用 → 版本管理与发布」创建版本「${version.name}」并提交发布；` +
      '发布/审核由平台流程控制，无法通过公开 API 完全自动化。',
    detail: 'version submit/review is a platform-controlled, partly manual action',
  };
}
