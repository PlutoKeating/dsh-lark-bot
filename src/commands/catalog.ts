export interface CommandDefinition {
  names: readonly [`/${string}`, ...Array<`/${string}`>];
  zh: string;
  en: string;
  area: 'session' | 'workspace' | 'operations' | 'policy' | 'configuration' | 'communication';
}

export const COMMAND_CATALOG: readonly CommandDefinition[] = [
  { names: ['/new', '/reset'], area: 'session', zh: '开始新会话', en: 'start a new session' },
  { names: ['/newg'], area: 'session', zh: '`<群名>` — 新建群聊并开始独立会话', en: '`<name>` — create a group and start an independent session' },
  { names: ['/cd'], area: 'workspace', zh: '`<path>` — 切换到该目录的独立会话', en: '`<path>` — switch to that directory’s independent session' },
  { names: ['/ws'], area: 'workspace', zh: '`list|save <name>|use <name>|remove <name>` — 管理工作空间', en: '`list|save <name>|use <name>|remove <name>` — manage workspaces' },
  { names: ['/status'], area: 'operations', zh: '查看状态、上下文/token 与待处理卡', en: 'show status, context/token usage, and pending cards' },
  { names: ['/jobs'], area: 'operations', zh: '`[show <消息ID>|retry <消息ID>]` — 对账并重试任务', en: '`[show <message-id>|retry <message-id>]` — reconcile and retry jobs' },
  { names: ['/version'], area: 'operations', zh: '查看当前与最新版本', en: 'show installed and latest versions' },
  { names: ['/upgrade'], area: 'operations', zh: '检查并确认机器人自更新（管理员）', en: 'check and confirm a bot self-update (admin)' },
  { names: ['/doctor'], area: 'operations', zh: '生成脱敏诊断包（管理员）', en: 'generate a redacted diagnostic bundle (admin)' },
  { names: ['/resume'], area: 'session', zh: '查看当前会话最近上下文', en: 'show recent context for this session' },
  { names: ['/session'], area: 'session', zh: '`[current|bind <sessionId>]` — 显式绑定 DSH session', en: '`[current|bind <sessionId>]` — explicitly bind a DSH session' },
  { names: ['/stop'], area: 'operations', zh: '终止当前 scope 的任务', en: 'stop tasks in the current scope' },
  { names: ['/timeout'], area: 'operations', zh: '`[N|off|default]` — 查看或设置空闲超时', en: '`[N|off|default]` — view or set idle timeout' },
  { names: ['/concurrency'], area: 'operations', zh: '`[N|default]` — 查看或设置 scope 并行数', en: '`[N|default]` — view or set scope concurrency' },
  { names: ['/permission'], area: 'policy', zh: '`[ask|allow|deny] [scope]` — 工具权限策略', en: '`[ask|allow|deny] [scope]` — tool permission policy' },
  { names: ['/isolation'], area: 'policy', zh: '`[group|topic|member]` — 群会话隔离（设置需管理员）', en: '`[group|topic|member]` — group isolation (admin to set)' },
  { names: ['/role'], area: 'configuration', zh: '`list|show|set|clear|save|remove …` — 管理角色', en: '`list|show|set|clear|save|remove …` — manage roles' },
  { names: ['/notify'], area: 'communication', zh: '`<scope|chatId> <text>` / `list` — 跨会话通知（发送需管理员）', en: '`<scope|chatId> <text>` / `list` — cross-session notification (admin to send)' },
  { names: ['/notifications'], area: 'communication', zh: '`[show|off|on …]` — scope 提醒策略', en: '`[show|off|on …]` — scope notification policy' },
  { names: ['/replies'], area: 'communication', zh: '`[show|default|set …]` — 回复合并、频率与去重', en: '`[show|default|set …]` — reply batching, rate, and deduplication' },
  { names: ['/retention'], area: 'session', zh: '`[N|default]` — 会话保留条数', en: '`[N|default]` — retained live-message count' },
  { names: ['/archive'], area: 'session', zh: '`[note]|send|list|clean …` — 管理归档', en: '`[note]|send|list|clean …` — manage archives' },
  { names: ['/density'], area: 'configuration', zh: '`[compact|standard|detailed]` — 卡片密度', en: '`[compact|standard|detailed]` — card density' },
  { names: ['/mode', '/effort'], area: 'configuration', zh: '`[quick|balanced|deep]` — 下一轮任务强度', en: '`[quick|balanced|deep]` — next-turn execution strength' },
  { names: ['/model'], area: 'configuration', zh: '`[use|default|reset|add|remove …]` — 查询与管理模型', en: '`[use|default|reset|add|remove …]` — query and manage models' },
  { names: ['/providers', '/provider'], area: 'configuration', zh: '`[add|update|remove …]` — 查询与管理 provider', en: '`[add|update|remove …]` — query and manage providers' },
  { names: ['/key'], area: 'configuration', zh: '`list|set <引用名>|remove <引用名>` — 凭据引用；值用安全表单', en: '`list|set <reference>|remove <reference>` — credential references; values use a secure form' },
  { names: ['/secret'], area: 'configuration', zh: '`status|set|remove <目标> <引用>` — 安全采集或删除密钥（管理员）', en: '`status|set|remove <target> <reference>` — securely collect or remove secrets (admin)' },
  { names: ['/language'], area: 'configuration', zh: '`show|set plain|agent <值>|reset [plain|agent|all]` — 默认语言策略（写需管理员）', en: '`show|set plain|agent <value>|reset [plain|agent|all]` — default language policy (admin writes)' },
  { names: ['/ask'], area: 'communication', zh: '`<问题>` — 发送结构化问答卡', en: '`<question>` — send a structured question card' },
  { names: ['/invite'], area: 'policy', zh: '`user|admin|group <id>` — 管理访问白名单', en: '`user|admin|group <id>` — manage access allowlists' },
  { names: ['/help'], area: 'operations', zh: '显示本帮助', en: 'show this help' },
] as const;

export function renderCommandHelp(locale: 'zh' | 'en'): string {
  const title = locale === 'zh' ? '**dsh-lark-bot 命令**' : '**dsh-lark-bot commands**';
  return [title, '', ...COMMAND_CATALOG.map((entry) =>
    `- ${entry.names.map((name) => `\`${name}\``).join(' ')} — ${locale === 'zh' ? entry.zh : entry.en}`,
  )].join('\n');
}

export function renderSkillCommandIndex(): string {
  return COMMAND_CATALOG.map((entry) =>
    `- ${entry.names.map((name) => `\`${name}\``).join(' ')}: ${entry.en}`,
  ).join('\n');
}

export function assertCommandCatalogMatches(handlerNames: readonly string[]): void {
  const catalog = new Set(COMMAND_CATALOG.flatMap((entry) => entry.names));
  const handlers = new Set(handlerNames);
  const missingHandlers = [...catalog].filter((name) => !handlers.has(name));
  const missingCatalog = [...handlers].filter((name) => !catalog.has(name as `/${string}`));
  if (missingHandlers.length || missingCatalog.length) {
    throw new Error(
      `command catalog drift: no handler=${missingHandlers.join(',') || '(none)'}; no catalog=${missingCatalog.join(',') || '(none)'}`,
    );
  }
}
