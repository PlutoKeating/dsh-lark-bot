import type { SinkMessage } from './types.js';

/**
 * Render a plain-text (markdown-free) notification body shared by the
 * stateless, push-only sinks (Telegram Bot API, WeCom group robot webhook).
 * There is no per-viewer language on these channels, so we keep the bilingual
 * title pair and scope/detail, stripping feishu markdown noise (backticks,
 * bold/italic markers) that would otherwise render as raw symbols.
 */
export function renderSinkText(message: SinkMessage): string {
  const zhLine = `${message.title.zh}（scope \`${message.scope}\`）${message.detail ? `：${message.detail}` : ''}`;
  const enLine = `${message.title.en} (scope \`${message.scope}\`)${message.detail ? `: ${message.detail}` : ''}`;
  return `${stripMarkdown(zhLine)}\n\n${stripMarkdown(enLine)}`;
}

/** True when the destination requires HTML escapable text (Telegram `parse_mode=HTML`). */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Strip the feishu/telegram markdown symbols used in notification titles. */
export function stripMarkdown(value: string): string {
  return value
    .replaceAll('`', '')
    .replaceAll('**', '')
    .replaceAll('*', '');
}
