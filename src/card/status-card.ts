import type { SessionMetrics } from '../session/store.js';
import { localizedCard, type CardLocale } from './i18n.js';

export interface StatusCardInput {
  scope: string;
  cwd: string;
  model: string;
  sessionId: string | undefined;
  activeRunIds: string[];
  version: string;
  isolation: string;
  permissionPolicy?: 'ask' | 'allow' | 'deny';
  role: string | undefined;
  metrics: SessionMetrics | undefined;
  pending: {
    approvals: number;
    questions: number;
    plans: number;
  };
  jobs?: {
    queued: number;
    running: number;
    completed: number;
    failed: number;
    interrupted: number;
  };
}

function amount(value: number | undefined, locale: CardLocale): string {
  return value === undefined ? (locale === 'zh_cn' ? '暂无' : 'Unavailable') : value.toLocaleString('en-US');
}

function contextLine(metrics: SessionMetrics | undefined, locale: CardLocale): string {
  const used = metrics?.contextUsedTokens;
  const limit = metrics?.contextWindow;
  const percent = used !== undefined && limit !== undefined && limit > 0
    ? `${((used / limit) * 100).toFixed(1)}%`
    : locale === 'zh_cn' ? '暂无' : 'Unavailable';
  return locale === 'zh_cn'
    ? `🧠 **上下文**：${amount(used, locale)} / ${amount(limit, locale)}（${percent}）`
    : `🧠 **Context**: ${amount(used, locale)} / ${amount(limit, locale)} (${percent})`;
}

function tokenLine(metrics: SessionMetrics | undefined, locale: CardLocale): string {
  return [
    `input \`${amount(metrics?.inputTokens, locale)}\``,
    `output \`${amount(metrics?.outputTokens, locale)}\``,
    `cache read \`${amount(metrics?.cacheReadTokens, locale)}\``,
    `cache write \`${amount(metrics?.cacheWriteTokens, locale)}\``,
  ].join(' · ');
}

function statusCardMarkdownFor(input: StatusCardInput, locale: CardLocale): string {
  const zh = locale === 'zh_cn';
  const runs = input.activeRunIds.length > 0
    ? input.activeRunIds.map((runId) => `\`${runId}\``).join(' ')
    : zh ? '无（空闲）' : 'None (idle)';
  return [
    zh ? '**📊 会话状态**' : '**📊 Session status**',
    '',
    `🧭 **scope**：\`${input.scope}\``,
    `📁 **cwd**：\`${input.cwd}\``,
    `🤖 **model**：\`${input.model}\``,
    `🔗 **session**：\`${input.sessionId ?? (zh ? '暂无' : 'Unavailable')}\``,
    zh ? `🏃 **运行状态**：${runs}` : `🏃 **Runs**: ${runs}`,
    `🔒 **isolation**：\`${input.isolation}\``,
    zh ? `🛡️ **工具权限**：\`${input.permissionPolicy ?? 'ask'}\`` : `🛡️ **Tool permission**: \`${input.permissionPolicy ?? 'ask'}\``,
    ...(input.role ? [`🎭 **role**：${input.role}`] : []),
    `🔖 **version**：\`${input.version}\``,
    '',
    contextLine(input.metrics, locale),
    zh ? `📈 **累计 token**：${tokenLine(input.metrics, locale)}` : `📈 **Cumulative tokens**: ${tokenLine(input.metrics, locale)}`,
    zh
      ? `⏳ **待处理**：审批 \`${String(input.pending.approvals)}\` · 提问 \`${String(input.pending.questions)}\` · 计划 \`${String(input.pending.plans)}\``
      : `⏳ **Pending**: approvals \`${String(input.pending.approvals)}\` · questions \`${String(input.pending.questions)}\` · plans \`${String(input.pending.plans)}\``,
    ...(input.jobs
      ? [zh
          ? `🧾 **任务账本**：排队 \`${input.jobs.queued}\` · 运行 \`${input.jobs.running}\` · 中断 \`${input.jobs.interrupted}\` · 失败 \`${input.jobs.failed}\``
          : `🧾 **Job ledger**: queued \`${input.jobs.queued}\` · running \`${input.jobs.running}\` · interrupted \`${input.jobs.interrupted}\` · failed \`${input.jobs.failed}\``]
      : []),
  ].join('\n');
}

export function statusCardMarkdown(input: StatusCardInput): string {
  return statusCardMarkdownFor(input, 'zh_cn');
}

export function statusCardMarkdownEnglish(input: StatusCardInput): string {
  return statusCardMarkdownFor(input, 'en_us');
}

export function renderStatusCard(input: StatusCardInput): object {
  const body = (locale: CardLocale) => ({
      elements: [
        { tag: 'markdown', content: statusCardMarkdownFor(input, locale) },
        {
          tag: 'column_set',
          flex_mode: 'none',
          horizontal_spacing: 'default',
          columns: [
            {
              tag: 'column',
              width: 'auto',
              vertical_align: 'center',
              elements: [
                {
                  tag: 'button',
                  text: { tag: 'plain_text', content: locale === 'zh_cn' ? '🔄 刷新' : '🔄 Refresh' },
                  type: 'primary',
                  value: {
                    cmd: 'status-refresh',
                    scope: input.scope,
                    isolation: input.isolation,
                  },
                },
              ],
            },
          ],
        },
      ],
    });
  return localizedCard({
    zhCn: { summary: '会话状态与 token 用量', body: body('zh_cn') },
    enUs: { summary: 'Session status and token usage', body: body('en_us') },
  });
}
