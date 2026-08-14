/**
 * Control signals understood by the safety-net guardian.
 *
 * While the dsh profile is down the guardian is the only Feishu listener, so
 * these commands are the user's rescue entrance. They are intentionally few
 * and stable:
 *
 * - `/safemode`            enter core-only safe mode (mount dsh core, no
 *                          third-party plugins) and start the restricted
 *                          conversation;
 * - `/safemode status`     report guardian / dsh / safe-mode state;
 * - `/safemode plugins`    list plugins installed into the broken profile
 *                          (diagnostics for self-healing);
 * - `/safemode exit`       leave safe mode, relaunch the full profile and
 *                          hand the Feishu channel back;
 * - `/safemode help`       print the above.
 */

export type GuardianControlKind =
  | 'safemode'
  | 'safemode-status'
  | 'safemode-plugins'
  | 'safemode-exit'
  | 'safemode-help';

export interface GuardianControl {
  kind: GuardianControlKind;
  /** Normalized argument after the command word, if any. */
  argument: string;
}

const COMMAND_RE = /^\/(safemode)(?:\s+(.+))?$/i;

export function parseGuardianCommand(text: string): GuardianControl | undefined {
  const trimmed = text.trim();
  const match = COMMAND_RE.exec(trimmed);
  if (!match) return undefined;
  const argument = match[2]?.trim().toLowerCase() ?? '';
  switch (argument) {
    case '':
    case 'start':
    case 'enter':
      return { kind: 'safemode', argument };
    case 'status':
      return { kind: 'safemode-status', argument };
    case 'plugins':
    case 'list':
      return { kind: 'safemode-plugins', argument };
    case 'exit':
    case 'quit':
    case 'leave':
    case 'restore':
      return { kind: 'safemode-exit', argument };
    case 'help':
    case '?':
      return { kind: 'safemode-help', argument };
    default:
      // Unknown sub-command: treat as help so the user sees valid options.
      return { kind: 'safemode-help', argument };
  }
}

export const SAFEMODE_HELP = [
  '/safemode — 进入仅核心安全模式（dsh 主核心 + 官方 headless，不加载任何第三方插件）',
  '/safemode status — 查看守护状态',
  '/safemode plugins — 列出故障 profile 已安装的插件',
  '/safemode exit — 退出安全模式，重启完整 profile 并交还飞书通道',
  '',
  '安全模式下发送普通消息即可与 dsh 核心对话，进行定位 / 修复 / 禁用损坏插件的自愈操作。',
].join('\n');

export const SAFEMODE_HELP_EN = [
  '/safemode — enter core-only safe mode (dsh core + official headless, no third-party plugins)',
  '/safemode status — show guardian state',
  '/safemode plugins — list plugins installed into the broken profile',
  '/safemode exit — leave safe mode, relaunch the full profile and hand the channel back',
  '',
  'In safe mode, send normal messages to converse with the dsh core for self-healing.',
].join('\n');

export function safemodeHelpText(): string {
  return `${SAFEMODE_HELP}\n\n${SAFEMODE_HELP_EN}`;
}
