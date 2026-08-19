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
  const body = (locale: CardLocale) => ({
      elements: [
        {
          tag: 'markdown',
          content: locale === 'zh_cn'
            ? '🧭 **计划已发送，请拍板**\n\n可直接批准，或填写修改意见后继续规划。'
            : '🧭 **The plan is ready for your decision**\n\nApprove it now, or add feedback and continue planning.',
        },
        {
          tag: 'form',
          name: `form-${input.id}`,
          elements: [
            {
              tag: 'input',
              name: 'feedback',
              placeholder: { tag: 'plain_text', content: locale === 'zh_cn' ? '可选：补充约束或修改意见…' : 'Optional: add constraints or requested changes…' },
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
                    text: { tag: 'plain_text', content: locale === 'zh_cn' ? '✅ 批准，开始执行' : '✅ Approve and execute' },
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
                    text: { tag: 'plain_text', content: locale === 'zh_cn' ? '📝 继续规划' : '📝 Keep planning' },
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
    });
  return localizedCard({
    zhCn: { summary: '计划等待确认', body: body('zh_cn') },
    enUs: { summary: 'Plan awaiting approval', body: body('en_us') },
  });
}
import { localizedCard, type CardLocale } from './i18n.js';
