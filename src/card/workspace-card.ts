export function renderWorkspaceCard(input: {
  current: string;
  index: Array<{ name: string; cwd: string; lastUsed: number | undefined }>;
}): object {
  const entries = input.index;
  const markdown = [
    `**当前工作目录**\n\`${input.current}\``,
    '',
    ...(entries.length > 0
      ? entries.map(({ name, cwd, lastUsed }) =>
          `- **${name}** → \`${cwd}\`${lastUsed ? ` · ${new Date(lastUsed).toLocaleString()}` : ''}`,
        )
      : ['暂无命名工作空间。']),
  ].join('\n');

  return {
    schema: '2.0',
    config: {
      summary: { content: '工作空间导航' },
    },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: markdown,
        },
      ],
    },
  };
}
