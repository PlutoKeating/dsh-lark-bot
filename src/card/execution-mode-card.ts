import type { ExecutionMode } from '../bot/execution-mode-store.js';
import { localizedCard, type CardLocale } from './i18n.js';

export interface ExecutionModeCardInput {
  scope: string;
  actorId: string;
  current: ExecutionMode;
}

const OPTIONS: Array<{
  mode: ExecutionMode;
  zh: string;
  en: string;
  zhDescription: string;
  enDescription: string;
}> = [
  { mode: 'quick', zh: '⚡ 快速', en: '⚡ Quick', zhDescription: '直接回答，只做完成任务所需的最少检查。', enDescription: 'Answer directly with only the checks needed to complete the task.' },
  { mode: 'balanced', zh: '⚖️ 平衡', en: '⚖️ Balanced', zhDescription: '兼顾速度与可靠性，适合大多数任务。', enDescription: 'Balance speed and reliability for most tasks.' },
  { mode: 'deep', zh: '🔬 深度', en: '🔬 Deep', zhDescription: '充分调查、验证假设与结果，适合复杂任务。', enDescription: 'Investigate thoroughly and verify assumptions and results.' },
];

function body(input: ExecutionModeCardInput, locale: CardLocale): Record<string, unknown> {
  const zh = locale === 'zh_cn';
  return {
    elements: [
      {
        tag: 'markdown',
        content: zh
          ? `当前模式：**${label(input.current, locale)}**\n\n切换只影响下一轮，不会中断正在运行的任务或清空会话上下文。`
          : `Current mode: **${label(input.current, locale)}**\n\nChanges apply to the next turn and do not interrupt active work or clear session context.`,
      },
      ...OPTIONS.flatMap((option) => [
        { tag: 'markdown', content: zh ? `**${option.zh}** — ${option.zhDescription}` : `**${option.en}** — ${option.enDescription}` },
        {
          tag: 'button',
          text: { tag: 'plain_text', content: zh ? `选择${option.zh}` : `Choose ${option.en}` },
          type: option.mode === input.current ? 'primary' : 'default',
          value: {
            cmd: 'execution-mode',
            mode: option.mode,
            scope: input.scope,
            actorId: input.actorId,
          },
        },
      ]),
    ],
  };
}

function label(mode: ExecutionMode, locale: CardLocale): string {
  const option = OPTIONS.find((candidate) => candidate.mode === mode)!;
  return locale === 'zh_cn' ? option.zh : option.en;
}

export function renderExecutionModeCard(input: ExecutionModeCardInput): object {
  return localizedCard({
    zhCn: { summary: '选择任务执行模式', body: body(input, 'zh_cn'), header: { title: { tag: 'plain_text', content: '任务执行模式' }, template: 'blue' } },
    enUs: { summary: 'Choose an execution mode', body: body(input, 'en_us'), header: { title: { tag: 'plain_text', content: 'Task execution mode' }, template: 'blue' } },
  });
}
