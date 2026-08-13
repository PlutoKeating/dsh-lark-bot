export function renderWorkspaceCard(input: {
  current: string;
  named: Record<string, string>;
}): object {
  const entries = Object.entries(input.named);
  const markdown = [
    `**当前工作目录**\n\`${input.current}\``,
    '',
    ...(entries.length > 0
      ? entries.map(([name, cwd]) => `- **${name}** → \`${cwd}\``)
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
