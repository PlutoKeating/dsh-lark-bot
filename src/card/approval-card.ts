import type { ApprovalOption } from '../adapters/types.js';
import { redactSecrets, truncateUtf8Safe } from '../config/security.js';

export interface ApprovalCardInput {
  id: string;
  callId?: string;
  toolName: string;
  reason: string | undefined;
  toolInput?: unknown;
  options: readonly ApprovalOption[];
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

  const markdown = [
    '🔐 **审批请求**',
    '',
    `**工具** \`${safeText(input.toolName, 512)}\``,
    ...(input.reason ? ['', `**理由** ${safeText(input.reason, 2048)}`] : []),
    ...(input.toolInput === undefined
      ? ['', `**调用标识** \`${safeText(input.callId ?? input.id, 512)}\``, '', '执行参数已显示在当前运行卡的对应工具调用中。']
      : ['', '**执行内容**', '```json', printableInput(input.toolInput), '```']),
  ].join('\n');

  const actions = [
    ...(allow
      ? [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: `✅ ${allow.name}` },
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
            text: { tag: 'plain_text', content: `⛔ ${reject.name}` },
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
    schema: '2.0',
    config: {
      summary: { content: '审批请求' },
    },
    body: {
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
    },
  };
}

function printableInput(value: unknown): string {
  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  return safeText(text, 4000).replaceAll('```', '``\u200b`');
}

function safeText(text: string, maxBytes: number): string {
  const redacted = redactSecrets(text);
  const truncated = truncateUtf8Safe(redacted, maxBytes);
  return Buffer.byteLength(redacted, 'utf8') > maxBytes
    ? `${truncated}\n…（已截断）`
    : truncated;
}
