import type { CommandContext } from './index.js';

async function reply(ctx: CommandContext, markdown: string): Promise<void> {
  await ctx.channel.sendMarkdown(ctx.chatId, markdown, {
    replyTo: ctx.messageId,
  });
}

/** `/archive [note]` — export the full live session transcript to durable storage. */
export async function handleArchive(args: string, ctx: CommandContext): Promise<void> {
  const [sub, ...rest] = args.trim().split(/\s+/);
  const cwd = ctx.workspaces.cwdFor(ctx.scope) ?? ctx.defaultWorkspace;
  const archiver = ctx.archiver;

  if (sub === 'list') {
    const limitInput = rest[0] ?? '5';
    const limit = Number(limitInput);
    const n = Number.isInteger(limit) && limit > 0 ? limit : 5;
    const records = (await archiver.list(ctx.scope, cwd)).slice(0, n);
    if (records.length === 0) {
      await reply(ctx, '当前工作区还没有归档记录。');
      return;
    }
    const lines = records.map(
      (record) =>
        `- \`${record.archiveId}\` · ${String(record.messageCount)} msgs · ${record.source} · ${record.archivedAt}`,
    );
    await reply(ctx, [`**当前工作区归档记录**`, `\`${cwd}\``, '', ...lines].join('\n'));
    return;
  }

  if (sub === 'clean') {
    const pruneOptions = {
      scope: ctx.scope,
      cwd,
      ...(ctx.archiveMax > 0 ? { maxArchives: ctx.archiveMax } : {}),
      ...(ctx.archiveMaxAgeDays > 0
        ? { maxAgeMs: ctx.archiveMaxAgeDays * 24 * 60 * 60 * 1000 }
        : {}),
    };
    const removed = await archiver.prune(pruneOptions);
    await reply(ctx, removed > 0 ? `已清理 ${String(removed)} 条过期归档。` : '没有需要清理的归档。');
    return;
  }

  const history = ctx.sessions.fullHistoryFor(ctx.scope, cwd);
  const note = args.trim() || undefined;
  const record = await archiver.archive({
    scope: ctx.scope,
    cwd,
    messages: history,
    source: 'manual',
    ...(note === undefined ? {} : { note }),
  });
  const commit = record.gitCommit ? `（git commit \`${record.gitCommit}\`）` : '';
  await reply(
    ctx,
    [
      `已归档当前会话：**${String(record.messageCount)}** 条消息${commit}`,
      `- Markdown: \`${record.markdownPath}\``,
      `- JSONL: \`${record.jsonlPath}\``,
      '',
      '历史消息会按保留策略自动归档；可用 `/retention` 调整保留条数。',
    ].join('\n'),
  );
  await archiver.prune({
    scope: ctx.scope,
    cwd,
    ...(ctx.archiveMax > 0 ? { maxArchives: ctx.archiveMax } : {}),
    ...(ctx.archiveMaxAgeDays > 0
      ? { maxAgeMs: ctx.archiveMaxAgeDays * 24 * 60 * 60 * 1000 }
      : {}),
  });
}

/** `/retention [N|default]` — view or set the live message retention window. */
export async function handleRetention(args: string, ctx: CommandContext): Promise<void> {
  const input = args.trim();
  const effective = ctx.retentionStore.get(ctx.scope) ?? ctx.defaultRetention;

  if (!input) {
    await reply(
      ctx,
      `当前会话保留最近 **${String(effective)}** 条消息（超出部分自动归档）。可用 \`/retention <N|default>\` 调整。`,
    );
    return;
  }

  if (input === 'default') {
    ctx.retentionStore.clear(ctx.scope);
    await reply(ctx, `已恢复默认保留条数（${String(ctx.defaultRetention)}）。`);
    return;
  }

  const n = Number(input);
  if (!Number.isInteger(n) || n <= 0) {
    await reply(ctx, '用法：`/retention <N|default>`，N 为大于 0 的条数。');
    return;
  }

  ctx.retentionStore.set(ctx.scope, n);
  await reply(ctx, `已设置当前会话保留最近 **${String(n)}** 条消息。`);
}
