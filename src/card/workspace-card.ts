import { localizedCard, type CardLocale } from './i18n.js';

export function renderWorkspaceCard(input: {
  current: string;
  index: Array<{ name: string; cwd: string; lastUsed: number | undefined }>;
}): object {
  const body = (locale: CardLocale) => {
    const entries = input.index;
    const markdown = [
      locale === 'zh_cn' ? `**当前工作目录**\n\`${input.current}\`` : `**Current workspace**\n\`${input.current}\``,
      '',
      ...(entries.length > 0
        ? entries.map(({ name, cwd, lastUsed }) =>
            `- **${name}** → \`${cwd}\`${lastUsed ? ` · ${new Date(lastUsed).toLocaleString(locale === 'zh_cn' ? 'zh-CN' : 'en-US')}` : ''}`,
          )
        : [locale === 'zh_cn' ? '暂无命名工作空间。' : 'No named workspaces.']),
    ].join('\n');
    return {
      elements: [
        {
          tag: 'markdown',
          content: markdown,
        },
      ],
    };
  };
  return localizedCard({
    zhCn: { summary: '工作空间导航', body: body('zh_cn') },
    enUs: { summary: 'Workspace navigation', body: body('en_us') },
  });
}
