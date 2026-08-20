import { localizedCard } from './i18n.js';

/** Terminal status for a rejected native resume before the fresh-session retry. */
export function renderSessionRecoveryCard(): object {
  return localizedCard({
    config: { streaming_mode: false },
    zhCn: {
      summary: '会话状态已自动恢复',
      body: {
        elements: [
          {
            tag: 'markdown',
            content: '**会话状态已自动恢复**\n旧会话绑定不可用；历史已保留，任务正在新会话中继续执行。',
          },
        ],
      },
    },
    enUs: {
      summary: 'Session state recovered automatically',
      body: {
        elements: [
          {
            tag: 'markdown',
            content: '**Session state recovered automatically**\nThe previous binding was unavailable. History was preserved and the task is continuing in a fresh session.',
          },
        ],
      },
    },
  });
}
