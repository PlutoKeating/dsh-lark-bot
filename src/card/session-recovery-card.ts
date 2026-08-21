import { localizedCard } from './i18n.js';

/** Neutral status for a rejected native resume before the fresh-session retry. */
export function renderSessionRecoveryCard(): object {
  return localizedCard({
    config: { streaming_mode: false },
    zhCn: {
      summary: '正在恢复会话状态',
      body: {
        elements: [
          {
            tag: 'markdown',
            content: '**正在恢复会话状态**\n旧会话绑定不可用；历史已保留，正在尝试通过新会话继续任务。',
          },
        ],
      },
    },
    enUs: {
      summary: 'Recovering session state',
      body: {
        elements: [
          {
            tag: 'markdown',
            content: '**Recovering session state**\nThe previous binding was unavailable. History was preserved while a fresh-session retry is attempted.',
          },
        ],
      },
    },
  });
}
