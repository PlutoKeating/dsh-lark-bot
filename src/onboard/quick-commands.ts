/** Simple bilingual pair used by the quick-command catalog. */
export interface BilingualPair {
  zh: string;
  en: string;
}

export interface QuickCommand {
  /** The slash command name (without the leading `/`). */
  name: string;
  /** Short bilingual description shown in the picker. */
  description: BilingualPair;
  /** The default argument template shown after `/name `. */
  args?: string;
}

export interface QuickCommandRegistration {
  ok: boolean;
  registered: number;
  /** Manual steps when the programmatic registration could not run. */
  manualSteps?: string;
  detail?: string;
}

/** The bridges quick-command catalog (kept in sync with the command router). */
export const QUICK_COMMANDS: readonly QuickCommand[] = [
  { name: 'channels', description: { zh: '管理出站通知渠道（扫码即建）', en: 'Manage outbound notification channels (scan-to-bind)' }, args: 'list|add --qr <wechat|qq|telegram>' },
  { name: 'config', description: { zh: '模型 / 供应商 / 凭据卡', en: 'Model / provider / credential card' } },
  { name: 'provider', description: { zh: '供应商管理', en: 'Provider management' } },
  { name: 'key', description: { zh: '凭据管理', en: 'Credential management' } },
  { name: 'model', description: { zh: '模型选择', en: 'Model selection' } },
  { name: 'role', description: { zh: '角色切换 / 绑定', en: 'Role switch / bind' } },
  { name: 'mode', description: { zh: '任务强度', en: 'Task mode' } },
  { name: 'session', description: { zh: '浏览 / 绑定会话', en: 'Browse / bind a session' } },
  { name: 'status', description: { zh: '状态卡', en: 'Status card' } },
  { name: 'invite', description: { zh: '访问白名单 / 管理员', en: 'Access allowlist / admin' } },
];

/**
 * Attempt to register the quick-command catalog with a Feishu app. Without a
 * verified Open Platform contract this always reports a graceful skip and hands
 * back manual steps instead of failing the bridge.
 */
export async function registerQuickCommands(
  options: { appId: string; userToken?: string; apiBase?: string },
): Promise<QuickCommandRegistration> {
  if (!options.userToken) {
    return {
      ok: false,
      registered: 0,
      manualSteps:
        '飞书开放平台应用需先启用「快捷指令/快捷菜单」能力；可在开放平台或飞书客户端中将上方命令登记为快捷指令。',
      detail: 'requires an app-manager user token and a verified quick-command Open Platform contract',
    };
  }
  // Programmatic registration against the live Open Platform contract.
  return {
    ok: false,
    registered: 0,
    manualSteps:
      `在飞书开放平台（应用 ${options.appId}）的快捷指令配置中登记：\n` +
      QUICK_COMMANDS.map((command) => `  - /${command.name}`).join('\n'),
    detail: 'quick-command panel registration requires maintainer contract verification',
  };
}

/** Stable bilingual synopsis for the `/help` surface. */
export function quickCommandSynopsis(): BilingualPair {
  return {
    zh: QUICK_COMMANDS.map((command) => `\`/${command.name}${command.args ? ` ${command.args}` : ''}\``).join(' · '),
    en: QUICK_COMMANDS.map((command) => `\`/${command.name}${command.args ? ` ${command.args}` : ''}\``).join(' · '),
  };
}
