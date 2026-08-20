import { redactSecrets, truncateUtf8Safe } from '../config/security.js';
import type { DshSessionSummary } from '../session/projection-protocol.js';
import { localizedCard, type CardLocale } from './i18n.js';

export interface SessionActionIdentity {
  scope: string;
  workspaceCwd: string;
  actorId: string;
}

export function renderSessionSelectorCard(input: {
  sessions: DshSessionSummary[];
  identity: SessionActionIdentity;
}): object {
  const body = (locale: CardLocale) => {
    const zh = locale === 'zh_cn';
    return {
      elements: [
        {
          tag: 'markdown',
          content: [
            zh ? '**选择要绑定的 DSH session**' : '**Select a DSH session to bind**',
            '',
            zh ? `工作空间：\`${safe(input.identity.workspaceCwd, 512)}\`` : `Workspace: \`${safe(input.identity.workspaceCwd, 512)}\``,
            zh ? '列表只包含当前工作空间的普通 session，不展示消息正文。' : 'Only regular sessions in this workspace are listed; message bodies are hidden.',
          ].join('\n'),
        },
        ...input.sessions.map((session) => ({
          tag: 'column_set',
          flex_mode: 'none',
          horizontal_spacing: 'default',
          columns: [{
            tag: 'column',
            width: 'weighted',
            weight: 4,
            elements: [{
              tag: 'markdown',
              content: `**${safe(session.title ?? (zh ? '未命名会话' : 'Untitled session'), 256)}**\n\`${safe(session.sessionId, 256)}\` · ${new Date(session.updatedAt).toLocaleString(zh ? 'zh-CN' : 'en-US')}`,
            }],
          }, {
            tag: 'column',
            width: 'auto',
            elements: [{
              tag: 'button',
              text: { tag: 'plain_text', content: zh ? '选择' : 'Select' },
              type: 'primary',
              value: {
                cmd: 'session-projection',
                action: 'select',
                sessionId: session.sessionId,
                ...input.identity,
              },
            }],
          }],
        })),
      ],
    };
  };
  return localizedCard({
    zhCn: { summary: '选择 DSH session', body: body('zh_cn') },
    enUs: { summary: 'Select a DSH session', body: body('en_us') },
  });
}

export function renderSessionBindingConfirmCard(input: {
  nonce: string;
  session: DshSessionSummary;
  identity: SessionActionIdentity;
  backfillCount: number;
  replacesScopeSession?: string;
  migratesFromScope?: string;
}): object {
  const body = (locale: CardLocale) => {
    const zh = locale === 'zh_cn';
    const lines = [
      zh ? '**确认披露并绑定历史会话**' : '**Confirm history disclosure and binding**',
      '',
      `${zh ? '标题' : 'Title'}：**${safe(input.session.title ?? (zh ? '未命名会话' : 'Untitled session'), 256)}**`,
      `session：\`${safe(input.session.sessionId, 256)}\``,
      `${zh ? '工作空间' : 'Workspace'}：\`${safe(input.identity.workspaceCwd, 512)}\``,
      `${zh ? '更新时间' : 'Updated'}：${new Date(input.session.updatedAt).toLocaleString(zh ? 'zh-CN' : 'en-US')}`,
      `${zh ? '当前 scope' : 'Current scope'}：\`${safe(input.identity.scope, 512)}\``,
      `${zh ? '即将回填' : 'Messages to backfill'}：${input.backfillCount}`,
      ...(input.replacesScopeSession
        ? [zh ? `将替换当前绑定：\`${safe(input.replacesScopeSession, 256)}\`` : `Replaces current binding: \`${safe(input.replacesScopeSession, 256)}\``]
        : []),
      ...(input.migratesFromScope
        ? [zh ? `⚠️ 独占迁移：将从旧目标 \`${safe(input.migratesFromScope, 512)}\` 解绑。` : `⚠️ Exclusive migration: the old target \`${safe(input.migratesFromScope, 512)}\` will be unbound.`]
        : []),
      '',
      zh ? '确认前不会修改绑定，也不会发送历史。' : 'No binding changes or history disclosure occur before confirmation.',
    ];
    const value = {
      cmd: 'session-projection',
      nonce: input.nonce,
      scope: input.identity.scope,
      workspaceCwd: input.identity.workspaceCwd,
      actorId: input.identity.actorId,
    };
    return {
      elements: [
        { tag: 'markdown', content: lines.join('\n') },
        {
          tag: 'column_set',
          flex_mode: 'none',
          horizontal_spacing: 'default',
          columns: [
            {
              tag: 'column', width: 'auto', elements: [{
                tag: 'button', text: { tag: 'plain_text', content: zh ? '确认绑定' : 'Confirm binding' },
                type: 'primary', value: { ...value, action: 'confirm' },
              }],
            },
            {
              tag: 'column', width: 'auto', elements: [{
                tag: 'button', text: { tag: 'plain_text', content: zh ? '取消' : 'Cancel' },
                type: 'default', value: { ...value, action: 'cancel' },
              }],
            },
          ],
        },
      ],
    };
  };
  return localizedCard({
    zhCn: { summary: '确认 DSH session 绑定', body: body('zh_cn') },
    enUs: { summary: 'Confirm DSH session binding', body: body('en_us') },
  });
}

export interface TranscriptMessage {
  role: 'user' | 'assistant';
  content: string;
  source: 'feishu' | 'web' | 'tui' | 'other-dsh-client';
}

export function renderTranscriptCard(input: {
  title: string;
  sessionId: string;
  messages: TranscriptMessage[];
  truncated: boolean;
}): object {
  const body = (locale: CardLocale) => {
    const zh = locale === 'zh_cn';
    const rows = input.messages.map((message) => {
      const role = message.role === 'assistant' ? '🤖 Assistant' : `👤 ${sourceLabel(message.source, locale)}`;
      return `**${role}**\n${safe(message.content, 8_000)}`;
    });
    return { elements: [{
      tag: 'markdown',
      content: [
        `**${zh ? '历史回填' : 'History backfill'} · ${safe(input.title, 256)}**`,
        `session \`${safe(input.sessionId, 256)}\``,
        '',
        ...(rows.length ? rows.flatMap((row) => [row, '---']) : [zh ? '没有可展示的人类消息。' : 'No human-facing messages to display.']),
        ...(input.truncated ? [zh ? '… 已按数量或字节上限截断。' : '… Truncated by the count or byte limit.'] : []),
      ].join('\n'),
    }] };
  };
  return localizedCard({
    zhCn: { summary: 'DSH session 历史回填', body: body('zh_cn') },
    enUs: { summary: 'DSH session history backfill', body: body('en_us') },
  });
}

export function renderProjectedMessageCard(input: {
  role: 'user' | 'assistant';
  source: 'feishu' | 'web' | 'tui' | 'other-dsh-client';
  content: string;
  streaming?: boolean;
  fallback?: boolean;
}): object {
  const body = (locale: CardLocale) => {
    const zh = locale === 'zh_cn';
    const role = input.role === 'assistant' ? '🤖 Assistant' : `👤 ${sourceLabel(input.source, locale)}`;
    return { elements: [{
      tag: 'markdown',
      content: [
        `**${role}${input.streaming ? (zh ? ' · 生成中' : ' · Streaming') : ''}**`,
        ...(input.fallback ? [zh ? '_原消息无法更新，以下为后续增量。_' : '_The original message could not be updated; this is a follow-up increment._'] : []),
        '',
        safe(input.content, 24_000),
      ].join('\n'),
    }] };
  };
  return localizedCard({
    zhCn: { summary: input.streaming ? 'Assistant 生成中' : 'DSH session 消息', body: body('zh_cn') },
    enUs: { summary: input.streaming ? 'Assistant streaming' : 'DSH session message', body: body('en_us') },
  });
}

function sourceLabel(source: TranscriptMessage['source'], locale: CardLocale): string {
  if (source === 'feishu') return locale === 'zh_cn' ? '用户 · 来自飞书' : 'User · from Feishu/Lark';
  if (source === 'web') return locale === 'zh_cn' ? '用户 · 来自 WebUI' : 'User · from WebUI';
  if (source === 'tui') return locale === 'zh_cn' ? '用户 · 来自 dsh-TUI' : 'User · from dsh-TUI';
  return locale === 'zh_cn' ? '用户 · 来自其他 DSH 客户端' : 'User · from another DSH client';
}

function safe(value: string, maxBytes: number): string {
  return truncateUtf8Safe(redactSecrets(value), maxBytes).replaceAll('```', '``\u200b`');
}
