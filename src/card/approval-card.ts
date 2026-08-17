import type { ApprovalOption } from '../adapters/types.js';

export interface ApprovalCardInput {
  id: string;
  toolName: string;
  reason: string | undefined;
  options: readonly ApprovalOption[];
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
    `**工具** \`${input.toolName}\``,
    ...(input.reason ? ['', input.reason] : []),
  ].join('\n');

  const actions = [
    ...(allow
      ? [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: `✅ ${allow.name}` },
            type: 'primary',
            value: { cmd: 'approve', id: input.id, outcome: 'allow' },
          },
        ]
      : []),
    ...(reject
      ? [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: `⛔ ${reject.name}` },
            type: 'danger',
            value: { cmd: 'approve', id: input.id, outcome: 'reject' },
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
