import type { SessionMetrics } from '../session/store.js';

export interface StatusCardInput {
  scope: string;
  cwd: string;
  model: string;
  sessionId: string | undefined;
  activeRunIds: string[];
  version: string;
  isolation: string;
  role: string | undefined;
  metrics: SessionMetrics | undefined;
  pending: {
    approvals: number;
    questions: number;
    plans: number;
  };
}

function amount(value: number | undefined): string {
  return value === undefined ? '暂无' : value.toLocaleString('en-US');
}

function contextLine(metrics: SessionMetrics | undefined): string {
  const used = metrics?.contextUsedTokens;
  const limit = metrics?.contextWindow;
  const percent = used !== undefined && limit !== undefined && limit > 0
    ? `${((used / limit) * 100).toFixed(1)}%`
    : '暂无';
  return `🧠 **上下文**：${amount(used)} / ${amount(limit)}（${percent}）`;
}

function tokenLine(metrics: SessionMetrics | undefined): string {
  return [
    `input \`${amount(metrics?.inputTokens)}\``,
    `output \`${amount(metrics?.outputTokens)}\``,
    `cache read \`${amount(metrics?.cacheReadTokens)}\``,
    `cache write \`${amount(metrics?.cacheWriteTokens)}\``,
  ].join(' · ');
}

export function statusCardMarkdown(input: StatusCardInput): string {
  const runs = input.activeRunIds.length > 0
    ? input.activeRunIds.map((runId) => `\`${runId}\``).join(' ')
    : '无（空闲）';
  return [
    '**📊 会话状态**',
    '',
    `🧭 **scope**：\`${input.scope}\``,
    `📁 **cwd**：\`${input.cwd}\``,
    `🤖 **model**：\`${input.model}\``,
    `🔗 **session**：\`${input.sessionId ?? '暂无'}\``,
    `🏃 **运行状态**：${runs}`,
    `🔒 **isolation**：\`${input.isolation}\``,
    ...(input.role ? [`🎭 **role**：${input.role}`] : []),
    `🔖 **version**：\`${input.version}\``,
    '',
    contextLine(input.metrics),
    `📈 **累计 token**：${tokenLine(input.metrics)}`,
    `⏳ **待处理**：审批 \`${String(input.pending.approvals)}\` · 提问 \`${String(input.pending.questions)}\` · 计划 \`${String(input.pending.plans)}\``,
  ].join('\n');
}

export function renderStatusCard(input: StatusCardInput): object {
  const markdown = statusCardMarkdown(input);

  return {
    schema: '2.0',
    config: { summary: { content: '会话状态与 token 用量' } },
    body: {
      elements: [
        { tag: 'markdown', content: markdown },
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
                  text: { tag: 'plain_text', content: '🔄 刷新' },
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
    },
  };
}
