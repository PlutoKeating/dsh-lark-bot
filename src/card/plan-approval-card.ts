export interface PlanApprovalCardInput {
  id: string;
  actionScope: string;
}

/** Decision card shown after the complete plan has been sent as markdown. */
export function renderPlanApprovalCard(input: PlanApprovalCardInput): object {
  const actionValue = (decision: 'approved' | 'revise') => ({
    cmd: 'plan-submit',
    id: input.id,
    decision,
    scope: input.actionScope,
  });
  return {
    schema: '2.0',
    config: { summary: { content: '计划等待确认' } },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: '🧭 **计划已发送，请拍板**\n\n可直接批准，或填写修改意见后继续规划。',
        },
        {
          tag: 'form',
          name: `form-${input.id}`,
          elements: [
            {
              tag: 'input',
              name: 'feedback',
              placeholder: { tag: 'plain_text', content: '可选：补充约束或修改意见…' },
            },
            {
              tag: 'column_set',
              flex_mode: 'none',
              horizontal_spacing: 'default',
              columns: [
                {
                  tag: 'column',
                  width: 'auto',
                  elements: [{
                    tag: 'button',
                    text: { tag: 'plain_text', content: '✅ 批准，开始执行' },
                    type: 'primary',
                    value: actionValue('approved'),
                    form_action_type: 'submit',
                    name: `approve-${input.id}`,
                  }],
                },
                {
                  tag: 'column',
                  width: 'auto',
                  elements: [{
                    tag: 'button',
                    text: { tag: 'plain_text', content: '📝 继续规划' },
                    value: actionValue('revise'),
                    form_action_type: 'submit',
                    name: `revise-${input.id}`,
                  }],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}
