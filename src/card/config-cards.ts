import type { DshProviderSummary } from '../config/dsh-config.js';
import { localizedCard, type CardLocale } from './i18n.js';

export interface ConfigHubInput {
  providers: DshProviderSummary[];
  defaultSelection: { provider: string; model: string } | undefined;
  currentModel: string;
  currentSelection: string;
}

export interface WizardOption {
  label: string;
  value: string;
}

export interface WizardOptionsStepCard {
  flow: string;
  step: number;
  question: string;
  options: WizardOption[];
  hint?: string;
}

export interface WizardTextStepCard {
  flow: string;
  step: number;
  question: string;
  placeholder?: string;
  hint?: string;
  /** Block empty submissions client-side; omit for optional fields. */
  required?: boolean;
}

export interface WizardConfirmStepCard {
  flow: string;
  step: number;
  summary: string;
  confirmLabel?: string;
}

function button(
  text: string,
  value: Record<string, unknown>,
  type: 'default' | 'primary' | 'danger' = 'default',
): object {
  return {
    tag: 'button',
    text: { tag: 'plain_text', content: text },
    type,
    value,
  };
}

/**
 * Feishu card schema 2.0 dropped the legacy `action` container (sub-code
 * 200861: "cards of schema V2 no longer support this capability"). Buttons
 * must live directly in `body.elements`; a `column_set` of auto-width
 * columns reproduces the old horizontal row layout.
 */
function buttonRow(buttons: object[]): object {
  return {
    tag: 'column_set',
    flex_mode: 'none',
    horizontal_spacing: 'default',
    columns: buttons.map((button) => ({
      tag: 'column',
      width: 'auto',
      vertical_align: 'center',
      elements: [button],
    })),
  };
}

function wizardValue(flow: string, step: number, extra: Record<string, unknown>): Record<string, unknown> {
  return { cmd: 'wizard', flow, step, ...extra };
}

export function renderConfigHubCard(input: ConfigHubInput): object {
  const body = (locale: CardLocale) => {
    const zh = locale === 'zh_cn';
    const providerLines = input.providers.map((provider) => {
    const models = provider.models.length > 0
      ? provider.models.map((model) => `\`${model.id}\``).join(' ')
      : zh ? '（无）' : '(none)';
    const credential = provider.credentialReady
      ? '✅'
      : provider.credentialRef === undefined
        ? zh ? '🔑未配置' : '🔑not configured'
        : zh ? '🔑缺失' : '🔑missing';
    return `- **${provider.displayName}**（\`${provider.id}\`）${credential}\n  ${models}`;
  });
  const defaultLine = input.defaultSelection
    ? `\`${input.defaultSelection.model}\`（provider \`${input.defaultSelection.provider}\`）`
    : zh ? '（未设置）' : '(not set)';
  const modelIdCounts = new Map<string, number>();
  for (const provider of input.providers) {
    for (const model of provider.models) {
      modelIdCounts.set(model.id, (modelIdCounts.get(model.id) ?? 0) + 1);
    }
  }
  const modelButtons = input.providers.flatMap((provider) =>
    provider.models.map((model) => {
      const selection = `${provider.id}/${model.id}`;
      const current = selection === input.currentSelection;
      return (
      button(
          `${current ? '✅ ' : ''}${model.id}${(modelIdCounts.get(model.id) ?? 0) > 1 ? ` · ${provider.displayName}` : ''}`,
          { cmd: 'cfg', action: 'model-use-direct', provider: provider.id, model: model.id },
          current ? 'primary' : 'default',
        )
      );
    }),
  );
  const modelRows: object[] = [];
  for (let index = 0; index < modelButtons.length; index += 3) {
    modelRows.push(buttonRow(modelButtons.slice(index, index + 3)));
  }

    return {
      elements: [
        {
          tag: 'markdown',
          content: [
            zh ? '**🔧 Provider / 模型 / 凭据管理**' : '**🔧 Provider / model / credential management**',
            '',
            ...providerLines,
            '',
            zh ? `当前会话模型：\`${input.currentModel}\`` : `Current session model: \`${input.currentModel}\``,
            zh ? `dsh 默认模型：${defaultLine}` : `dsh default model: ${defaultLine}`,
          ].join('\n'),
        },
        ...[
          ...(modelRows.length > 0
            ? [
              {
                tag: 'markdown',
                content: zh ? '**快速切换模型**（点击后下一轮消息生效）' : '**Quick model switch** (takes effect on the next message)',
              },
              ...modelRows,
            ]
            : []),
          buttonRow([
            button(zh ? '↩️ 恢复默认' : '↩️ Restore default', { cmd: 'cfg', action: 'model-reset' }),
          ]),
        ],
        buttonRow([
          button(zh ? '➕ 添加 Provider' : '➕ Add provider', { cmd: 'cfg', action: 'provider-add' }, 'primary'),
          button(zh ? '✏️ 修改 Provider' : '✏️ Edit provider', { cmd: 'cfg', action: 'provider-update' }),
          button(zh ? '🗑 删除 Provider' : '🗑 Remove provider', { cmd: 'cfg', action: 'provider-remove' }, 'danger'),
        ]),
        buttonRow([
          button(zh ? '🧠 添加模型' : '🧠 Add model', { cmd: 'cfg', action: 'model-add' }),
          button(zh ? '❌ 删除模型' : '❌ Remove model', { cmd: 'cfg', action: 'model-remove' }, 'danger'),
          button(zh ? '🎯 切换模型' : '🎯 Switch model', { cmd: 'cfg', action: 'model-use' }),
        ]),
        buttonRow([
          button(zh ? '🏠 设置默认模型' : '🏠 Set default model', { cmd: 'cfg', action: 'model-default' }),
          button(zh ? '🔑 设置凭据' : '🔑 Set credential', { cmd: 'cfg', action: 'key-set' }),
          button(zh ? '🔓 删除凭据' : '🔓 Remove credential', { cmd: 'cfg', action: 'key-remove' }, 'danger'),
        ]),
        buttonRow([
          button(zh ? '🔄 刷新' : '🔄 Refresh', { cmd: 'cfg', action: 'refresh' }),
          button(zh ? '✖️ 关闭' : '✖️ Close', { cmd: 'cfg', action: 'dismiss' }),
        ]),
      ],
    };
  };
  return localizedCard({
    zhCn: { summary: 'Provider / 模型 / 凭据管理', body: body('zh_cn') },
    enUs: { summary: 'Provider / model / credential management', body: body('en_us') },
  });
}

/** BotFather-style step card: tap one of the options. */
export function renderWizardOptionsCard(input: WizardOptionsStepCard): object {
  const body = (locale: CardLocale) => {
    const cancel = button(locale === 'zh_cn' ? '取消' : 'Cancel', wizardValue(input.flow, input.step, { cancel: true }));
    const rows: object[] = [];
  for (let index = 0; index < input.options.length; index += 3) {
    rows.push(
      buttonRow(
        input.options
          .slice(index, index + 3)
          .map((option, offset) =>
            button(locale === 'zh_cn' ? option.label : configEnglish(option.label), wizardValue(input.flow, input.step, { choose: index + offset })),
          ),
      ),
    );
  }
  rows.push(buttonRow([cancel]));
    return {
      elements: [
        {
          tag: 'markdown',
          content: [locale === 'zh_cn' ? input.question : configEnglish(input.question), input.hint ? `\n${locale === 'zh_cn' ? input.hint : configEnglish(input.hint)}` : ''].join(''),
        },
        ...rows,
      ],
    };
  };
  return localizedCard({
    zhCn: { summary: '向导 · 选择', body: body('zh_cn') },
    enUs: { summary: 'Wizard · Choose', body: body('en_us') },
  });
}

/**
 * BotFather-style step card: type a value into the input. The input and its
 * submit button are wrapped in a `form` container — schema 2.0 only returns
 * input values in the callback when the input lives inside a form.
 */
export function renderWizardTextStepCard(input: WizardTextStepCard): object {
  const body = (locale: CardLocale) => ({
      elements: [
        {
          tag: 'markdown',
          content: [locale === 'zh_cn' ? input.question : configEnglish(input.question), input.hint ? `\n${locale === 'zh_cn' ? input.hint : configEnglish(input.hint)}` : ''].join(''),
        },
        {
          tag: 'form',
          name: `form-${input.flow}-${input.step}`,
          elements: [
            {
              tag: 'input',
              name: 'answer',
              ...(input.required === true ? { required: true } : {}),
              placeholder: { tag: 'plain_text', content: input.placeholder ?? (locale === 'zh_cn' ? '请输入…' : 'Enter a value…') },
            },
            {
              ...button(locale === 'zh_cn' ? '提交' : 'Submit', wizardValue(input.flow, input.step, { submit: true }), 'primary'),
              form_action_type: 'submit',
              name: `btn-submit-${input.flow}-${input.step}`,
            },
          ],
        },
        button(locale === 'zh_cn' ? '取消' : 'Cancel', wizardValue(input.flow, input.step, { cancel: true })),
      ],
    });
  return localizedCard({
    zhCn: { summary: '向导 · 输入', body: body('zh_cn') },
    enUs: { summary: 'Wizard · Input', body: body('en_us') },
  });
}

/** Final review card before a write is applied. */
export function renderWizardConfirmStepCard(input: WizardConfirmStepCard): object {
  const body = (locale: CardLocale) => ({
      elements: [
        {
          tag: 'markdown',
          content: locale === 'zh_cn' ? `**确认以下内容？**\n\n${input.summary}` : `**Confirm these changes?**\n\n${configEnglish(input.summary)}`,
        },
        buttonRow([
          button(locale === 'zh_cn' ? (input.confirmLabel ?? '✅ 确认') : configEnglish(input.confirmLabel ?? '✅ 确认'), wizardValue(input.flow, input.step, { confirm: true }), 'primary'),
          button(locale === 'zh_cn' ? '取消' : 'Cancel', wizardValue(input.flow, input.step, { cancel: true })),
        ]),
      ],
    });
  return localizedCard({
    zhCn: { summary: '向导 · 确认', body: body('zh_cn') },
    enUs: { summary: 'Wizard · Confirm', body: body('en_us') },
  });
}

const CONFIG_COPY: ReadonlyArray<readonly [string, string]> = [
  ['选择 API 协议（OpenAI 兼容网关一般选第一个）', 'Choose an API protocol (the first option usually fits OpenAI-compatible gateways)'],
  ['给这个 Provider 起个 ID', 'Choose an ID for this provider'],
  ['显示名称（可选）', 'Display name (optional)'],
  ['模型 ID（多个用逗号分隔）', 'Model IDs (comma-separated)'],
  ['API Key 引用名（可选）', 'API key reference (optional)'],
  ['现在就设置密钥值吗？', 'Set the credential value now?'],
  ['🔑 现在设置', '🔑 Set now'],
  ['稍后 /key set', 'Later with /key set'],
  ['粘贴 API Key 值', 'Paste the API key value'],
  ['选择要修改的 Provider', 'Choose a provider to edit'],
  ['修改哪个字段？', 'Which field should be changed?'],
  ['显示名称', 'Display name'],
  ['API 协议', 'API protocol'],
  ['模型列表', 'Model list'],
  ['API Key 引用名', 'API key reference'],
  ['输入新值', 'Enter the new value'],
  ['选择要删除的 Provider（删除后不可恢复）', 'Choose a provider to remove (this cannot be undone)'],
  ['把模型加到哪个 Provider？', 'Which provider should receive the model?'],
  ['显示名称（可选，留空用 ID）', 'Display name (optional; leave blank to use the ID)'],
  ['从哪个 Provider 删除？', 'Remove from which provider?'],
  ['选择要删除的模型', 'Choose a model to remove'],
  ['选择当前会话要使用的模型', 'Choose the model for this session'],
  ['选择 dsh 默认模型（agent-default-model）', 'Choose the dsh default model (agent-default-model)'],
  ['凭据引用名', 'Credential reference'],
  ['粘贴密钥值', 'Paste the credential value'],
  ['选择要删除的凭据引用', 'Choose a credential reference to remove'],
  ['✅ 确认', '✅ Confirm'],
  ['小写字母开头，仅含 a-z 0-9 . _ -', 'Start with a lowercase letter; use only a-z, 0-9, ., _, or -'],
  ['环境变量名：字母/数字/下划线，字母开头', 'Environment variable name: letters, digits, and underscores; start with a letter'],
  ['⚠️ 群聊中输入的密钥对群成员可见，建议私聊操作；回复中不会回显', '⚠️ Credentials entered in a group are visible to group members. Prefer a direct chat; replies never echo the value.'],
  ['⚠️ 未知的向导流程，已取消。', '⚠️ Unknown wizard flow; cancelled.'],
  ['仅管理员可执行该操作，向导已取消。', 'Only admins can perform this operation; the wizard was cancelled.'],
  ['仅管理员可执行该操作。', 'Only admins can perform this operation.'],
  ['当前环境不支持交互卡片，请用文字命令完成该操作', 'Interactive cards are unavailable here; use the text command instead'],
  ['管理卡片刷新失败', 'Management card refresh failed'],
  ['操作失败', 'Operation failed'],
  ['请重新填写', 'Please enter it again'],
  ['该项不能为空', 'This field cannot be empty'],
  ['【确认】', '**Confirm**'],
  ['该向导已失效或已过期（30 分钟无操作自动取消），请重新发起。', 'This wizard is invalid or expired (it cancels after 30 minutes of inactivity). Start it again.'],
  ['已取消。', 'Cancelled.'],
  ['选项已失效，请重新选择。', 'The option is no longer valid. Choose again.'],
  ['Provider / 模型 / 凭据管理', 'Provider / model / credential management'],
  ['凭据就绪', 'credential ready'],
  ['凭据缺失', 'credential missing'],
  ['当前环境不支持交互卡片，请用 `/provider` `/model` `/key` 文字命令。', 'Interactive cards are unavailable here; use the `/provider`, `/model`, or `/key` text command.'],
  ['该模型已不可用，请刷新后重试。', 'This model is no longer available. Refresh and try again.'],
  ['已热切换当前会话模型', 'Switched this session model'],
  ['已恢复默认模型', 'Restored the default model'],
  ['下一轮消息生效，上下文保留', 'takes effect on the next message; context is preserved'],
  ['未知操作。', 'Unknown operation.'],
  ['已添加 provider', 'Added provider'],
  ['已更新 provider', 'Updated provider'],
  ['已删除 provider', 'Removed provider'],
  ['未找到 provider', 'Provider not found'],
  ['已添加模型', 'Added model'],
  ['已删除模型', 'Removed model'],
  ['未找到模型', 'Model not found'],
  ['已写入 dsh 默认模型', 'Set the dsh default model'],
  ['已写入凭据', 'Stored credential'],
  ['已删除凭据', 'Removed credential'],
  ['未找到凭据', 'Credential not found'],
  ['值已隐藏', 'value hidden'],
  ['下一请求生效', 'takes effect on the next request'],
  ['无需重启 bot', 'no bot restart is needed'],
  ['新会话生效', 'takes effect for new sessions'],
  ['密钥不会显示在聊天中。', 'Secrets are never shown in chat.'],
];

export function configEnglish(text: string): string {
  return text.split('\n').map(translateConfigLine).join('\n');
}

const CONFIG_PREFIX_COPY: ReadonlyArray<readonly [string, string]> = [
  ['Provider：', 'Provider: '],
  ['字段：', 'Field: '],
  ['新值：', 'New value: '],
  ['协议：', 'Protocol: '],
  ['ID：', 'ID: '],
  ['显示名称：', 'Display name: '],
  ['模型：', 'Models: '],
  ['名称：', 'Name: '],
  ['凭据引用：', 'Credential reference: '],
  ['值：**（已隐藏）**', 'Value: **(hidden)**'],
  ['将写入 dsh 默认模型：', 'Set dsh default model: '],
  ['将删除凭据引用：', 'Remove credential reference: '],
  ['将删除 provider：', 'Remove provider: '],
  ['⚠️ 操作失败：', '⚠️ Operation failed: '],
  ['（管理卡片刷新失败：', '(Management card refresh failed: '],
];

const CONFIG_SUFFIX_COPY: ReadonlyArray<readonly [string, string]> = [
  ['（本次写入值）', ' (value will be stored now)'],
  ['（未写入值）', ' (value not stored)'],
];

function translateConfigLine(line: string): string {
  const exact = CONFIG_COPY.find(([zh]) => line === zh);
  if (exact) return exact[1];

  const titled = /^【([^】]+)】(.*)$/u.exec(line);
  if (titled) {
    const title = translateConfigLine(titled[1] ?? '');
    const content = translateConfigLine(titled[2] ?? '');
    return `【${title}】${content}`;
  }

  let translated = line;
  const prefix = CONFIG_PREFIX_COPY.find(([zh]) => translated.startsWith(zh));
  if (prefix) translated = `${prefix[1]}${translated.slice(prefix[0].length)}`;
  const suffix = CONFIG_SUFFIX_COPY.find(([zh]) => translated.endsWith(zh));
  if (suffix) translated = `${translated.slice(0, -suffix[0].length)}${suffix[1]}`;
  return translated;
}
