import type { CommandContext } from './index.js';
import { bilingualMarkdown } from '../card/i18n.js';
import { dirname } from 'node:path';
import { prepareOutboundFile } from '../media/outbound-files.js';
import type { ArchiveRecord } from '../session/archive.js';

async function reply(ctx: CommandContext, zhCn: string, enUs: string): Promise<void> {
  await ctx.channel.sendMarkdown(ctx.chatId, bilingualMarkdown(zhCn, enUs), {
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
      await reply(ctx, '当前工作区还没有归档记录。', 'This workspace has no archives yet.');
      return;
    }
    const lines = records.map(
      (record) =>
        `- \`${record.archiveId}\` · ${String(record.messageCount)} msgs · ${record.source} · ${record.archivedAt}`,
    );
    await reply(ctx, ['**当前工作区归档记录**', `\`${cwd}\``, '', ...lines].join('\n'), ['**Workspace archives**', `\`${cwd}\``, '', ...lines].join('\n'));
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
    await reply(ctx, removed > 0 ? `已清理 ${String(removed)} 条过期归档。` : '没有需要清理的归档。', removed > 0 ? `Removed ${String(removed)} expired archive(s).` : 'No archives need cleaning.');
    return;
  }

  if (sub === 'send') {
    const archiveId = rest[0];
    const target = rest[1];
    if (!archiveId) {
      await reply(ctx, '用法：`/archive send <archiveId> [scope|chatId]`', 'Usage: `/archive send <archiveId> [scope|chatId]`');
      return;
    }
    if (rest.length > 2) {
      await reply(ctx, '用法：`/archive send <archiveId> [scope|chatId]`', 'Usage: `/archive send <archiveId> [scope|chatId]`');
      return;
    }
    if (target && !ctx.accessManager.isAdmin(ctx.senderId)) {
      await reply(ctx, '仅管理员可把归档发送到其他会话。', 'Only admins can send archives to another session.');
      return;
    }
    const destination = target
      ? ctx.scopeDirectory.resolve(target) ?? ctx.scopeDirectory.resolveChat(target)
      : { chatId: ctx.chatId, threadId: ctx.threadId, messageId: ctx.messageId };
    if (!destination) {
      await reply(ctx, `未知的目标 scope/chat：\`${target ?? ''}\`。可用 \`/notify list\` 查看已注册的 scope。`, `Unknown target scope/chat: \`${target ?? ''}\`. Use \`/notify list\` to list registered scopes.`);
      return;
    }
    const record = (await archiver.list(ctx.scope, cwd)).find((item) => item.archiveId === archiveId);
    if (!record) {
      await reply(ctx, `未找到当前工作区归档：\`${archiveId}\``, `Archive not found in this workspace: \`${archiveId}\``);
      return;
    }
    const result = await sendArchiveFiles(ctx, record, destination, target);
    await reply(ctx, result.zh, result.en);
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
  const delivery = await sendArchiveFiles(ctx, record);
  await reply(
    ctx,
    [
      `已归档当前会话：**${String(record.messageCount)}** 条消息${commit}`,
      `- Markdown: \`${record.markdownPath}\``,
      `- JSONL: \`${record.jsonlPath}\``,
      '',
      delivery.zh,
      '',
      '历史消息会按保留策略自动归档；可用 `/retention` 调整保留条数。',
      ].join('\n'),
      [
        `Archived this session: **${String(record.messageCount)}** messages${record.gitCommit ? ` (git commit \`${record.gitCommit}\`)` : ''}`,
        `- Markdown: \`${record.markdownPath}\``,
        `- JSONL: \`${record.jsonlPath}\``,
        '',
        delivery.en,
        '',
        'Older messages are archived automatically according to retention policy; use `/retention` to change the live-message limit.',
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

async function sendArchiveFiles(
  ctx: CommandContext,
  record: Pick<ArchiveRecord, 'archiveId' | 'markdownPath' | 'jsonlPath'>,
  destination: { chatId: string; threadId: string | undefined; messageId?: string } = {
    chatId: ctx.chatId,
    threadId: ctx.threadId,
    messageId: ctx.messageId,
  },
  target?: string,
): Promise<{ zh: string; en: string }> {
  if (!ctx.channel.sendFile) {
    return {
      zh: '当前渠道不支持文件上传；归档已保存在上述本地路径。',
      en: 'This channel does not support file uploads; the archive remains at the local paths above.',
    };
  }
  const failures: string[] = [];
  let sent = 0;
  for (const [path, fileName] of [
    [record.markdownPath, `${record.archiveId}.md`],
    [record.jsonlPath, `${record.archiveId}.jsonl`],
  ] as const) {
    try {
      const prepared = await prepareOutboundFile({ path, baseDir: dirname(path), allowedRoots: [dirname(path)], fileName });
      await ctx.channel.sendFile(destination.chatId, prepared.fileName, prepared.content, {
        ...(destination.messageId ? { replyTo: destination.messageId } : {}),
        ...(destination.threadId ? { threadId: destination.threadId } : {}),
      });
      sent += 1;
    } catch (error) {
      failures.push(`${fileName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length === 0) {
    return target
      ? { zh: `已将 ${String(sent)} 个归档文件发送到 \`${target}\`。`, en: `Sent ${String(sent)} archive files to \`${target}\`.` }
      : { zh: `已将 ${String(sent)} 个归档文件发送到当前聊天。`, en: `Sent ${String(sent)} archive files to this chat.` };
  }
  return {
    zh: `已发送 ${String(sent)} 个文件；${String(failures.length)} 个失败：${failures.join('；')}`,
    en: `Sent ${String(sent)} file(s); ${String(failures.length)} failed: ${failures.join('; ')}`,
  };
}

/** `/retention [N|default]` — view or set the live message retention window. */
export async function handleRetention(args: string, ctx: CommandContext): Promise<void> {
  const input = args.trim();
  const effective = ctx.retentionStore.get(ctx.scope) ?? ctx.defaultRetention;

  if (!input) {
    await reply(
      ctx,
      `当前会话保留最近 **${String(effective)}** 条消息（超出部分自动归档）。可用 \`/retention <N|default>\` 调整。`,
      `This session retains the latest **${String(effective)}** messages; older messages are archived automatically. Use \`/retention <N|default>\` to change it.`,
    );
    return;
  }

  if (input === 'default') {
    ctx.retentionStore.clear(ctx.scope);
    await reply(ctx, `已恢复默认保留条数（${String(ctx.defaultRetention)}）。`, `Restored the default retention limit (${String(ctx.defaultRetention)}).`);
    return;
  }

  const n = Number(input);
  if (!Number.isInteger(n) || n <= 0) {
    await reply(ctx, '用法：`/retention <N|default>`，N 为大于 0 的条数。', 'Usage: `/retention <N|default>`, where N is a positive message count.');
    return;
  }

  ctx.retentionStore.set(ctx.scope, n);
  await reply(ctx, `已设置当前会话保留最近 **${String(n)}** 条消息。`, `This session will retain the latest **${String(n)}** messages.`);
}
