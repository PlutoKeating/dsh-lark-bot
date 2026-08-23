import { localizedCard, type CardLocale } from './i18n.js';
import type { SecretRequestView } from '../secret/registry.js';

export function renderSecretCard(input: SecretRequestView): object {
  const body = (locale: CardLocale) => ({ elements: [
    { tag: 'markdown', content: locale === 'zh_cn'
      ? `🔐 **安全密钥采集**\n\n目标：\`${input.target}\` · 引用：\`${input.reference}\`\n\n${input.purpose}\n\n值仅由本地桥接进程写入，不会发送给 Agent。`
      : `🔐 **Secure secret collection**\n\nTarget: \`${input.target}\` · Reference: \`${input.reference}\`\n\n${input.purpose}\n\nThe value is written only by the local bridge and is not sent to the agent.` },
    { tag: 'form', name: `form-${input.id}`, elements: [
      { tag: 'input', name: 'secret', input_type: 'password', placeholder: { tag: 'plain_text', content: locale === 'zh_cn' ? '输入密钥（不会回显）' : 'Enter secret (not echoed)' } },
      { tag: 'button', type: 'primary', text: { tag: 'plain_text', content: locale === 'zh_cn' ? '安全保存' : 'Save securely' }, value: { cmd: 'secret-submit', id: input.id, scope: input.scope }, form_action_type: 'submit', name: `submit-${input.id}` },
      { tag: 'button', text: { tag: 'plain_text', content: locale === 'zh_cn' ? '取消' : 'Cancel' }, value: { cmd: 'secret-cancel', id: input.id, scope: input.scope } },
    ] },
  ] });
  return localizedCard({ zhCn: { summary: '安全密钥采集', body: body('zh_cn') }, enUs: { summary: 'Secure secret collection', body: body('en_us') } });
}
