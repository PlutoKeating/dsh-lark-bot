import type { ApprovalOption } from '../adapters/types.js';
import { redactSecrets, truncateUtf8Safe } from '../config/security.js';
import { localizedCard, type CardLocale } from './i18n.js';

export interface ApprovalCardInput {
  id: string;
  callId?: string;
  toolName: string;
  reason: string | undefined;
  toolInput?: unknown;
  options: readonly ApprovalOption[];
  /** Bot-owned translations keyed by optionId; adapter labels stay untouched. */
  englishOptionNames?: Readonly<Record<string, string>>;
  actionScope?: string;
}

/**
 * Feishu approval card for ACP `session/request_permission`: one-shot
 * allow / reject buttons, mirroring the options offered by the harness.
 */
export function renderApprovalCard(input: ApprovalCardInput): object {
  const allow = input.options.find((option) => option.kind === 'allow_once') ??
    input.options.find((option) => option.kind === 'allow_always');
  const reject = input.options.find((option) => option.kind === 'reject_once') ??
    input.options.find((option) => option.kind === 'reject_always');

  const body = (locale: CardLocale) => {
    const zh = locale === 'zh_cn';
    const markdown = [
      zh ? '🔐 **审批请求**' : '🔐 **Approval request**',
      '',
      zh ? `**工具** \`${safeText(input.toolName, 512, locale)}\`` : `**Tool** \`${safeText(input.toolName, 512, locale)}\``,
      ...(input.reason ? ['', zh ? `**理由** ${safeText(input.reason, 2048, locale)}` : `**Reason** ${safeText(input.reason, 2048, locale)}`] : []),
      ...(input.toolInput === undefined
        ? ['', zh ? `**调用标识** \`${safeText(input.callId ?? input.id, 512, locale)}\`` : `**Call ID** \`${safeText(input.callId ?? input.id, 512, locale)}\``, '', zh ? '执行参数已显示在当前运行卡的对应工具调用中。' : 'Execution parameters are shown in the matching tool call on the current run card.']
        : ['', zh ? '**执行内容**' : '**Execution details**', '```json', printableInput(input.toolInput, locale), '```']),
    ].join('\n');

    const actions = [
    ...(allow
      ? [
          {
            tag: 'button',
            text: {
              tag: 'plain_text',
              content: `✅ ${locale === 'en_us'
                ? (input.englishOptionNames?.[allow.optionId] ?? allow.name)
                : allow.name}`,
            },
            type: 'primary',
            value: {
              cmd: 'approve',
              id: input.id,
              outcome: 'allow',
              ...(input.actionScope ? { scope: input.actionScope } : {}),
            },
          },
        ]
      : []),
    ...(reject
      ? [
          {
            tag: 'button',
            text: {
              tag: 'plain_text',
              content: `⛔ ${locale === 'en_us'
                ? (input.englishOptionNames?.[reject.optionId] ?? reject.name)
                : reject.name}`,
            },
            type: 'danger',
            value: {
              cmd: 'approve',
              id: input.id,
              outcome: 'reject',
              ...(input.actionScope ? { scope: input.actionScope } : {}),
            },
          },
        ]
      : []),
    ];
    return {
      elements: [
        { tag: 'markdown', content: markdown },
        ...(actions.length > 0
          ? [
              {
                tag: 'column_set',
                flex_mode: 'none',
                horizontal_spacing: 'default',
                columns: actions.map((button) => ({
                  tag: 'column',
                  width: 'auto',
                  vertical_align: 'center',
                  elements: [button],
                })),
              },
            ]
          : []),
      ],
    };
  };
  return localizedCard({
    zhCn: { summary: '审批请求', body: body('zh_cn') },
    enUs: { summary: 'Approval request', body: body('en_us') },
  });
}

function printableInput(value: unknown, locale: CardLocale): string {
  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  return safeText(text, 4000, locale).replaceAll('```', '``\u200b`');
}

function safeText(text: string, maxBytes: number, locale: CardLocale): string {
  const redacted = redactSecrets(text);
  const truncated = truncateUtf8Safe(redacted, maxBytes);
  return Buffer.byteLength(redacted, 'utf8') > maxBytes
    ? `${truncated}\n${locale === 'zh_cn' ? '…（已截断）' : '… (truncated)'}`
    : truncated;
}
