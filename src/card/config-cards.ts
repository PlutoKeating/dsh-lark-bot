import type { DshProviderSummary } from '../config/dsh-config.js';

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
  const providerLines = input.providers.map((provider) => {
    const models = provider.models.length > 0
      ? provider.models.map((model) => `\`${model.id}\``).join(' ')
      : '（无）';
    const credential = provider.credentialReady
      ? '✅'
      : provider.credentialRef === undefined
        ? '🔑未配置'
        : '🔑缺失';
    return `- **${provider.displayName}**（\`${provider.id}\`）${credential}\n  ${models}`;
  });
  const defaultLine = input.defaultSelection
    ? `\`${input.defaultSelection.model}\`（provider \`${input.defaultSelection.provider}\`）`
    : '（未设置）';
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
    schema: '2.0',
    config: {
      summary: { content: 'Provider / 模型 / 凭据管理' },
    },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: [
            '**🔧 Provider / 模型 / 凭据管理**',
            '',
            ...providerLines,
            '',
            `当前会话模型：\`${input.currentModel}\``,
            `dsh 默认模型：${defaultLine}`,
          ].join('\n'),
        },
        ...[
          ...(modelRows.length > 0
            ? [
              {
                tag: 'markdown',
                content: '**快速切换模型**（点击后下一轮消息生效）',
              },
              ...modelRows,
            ]
            : []),
          buttonRow([
            button('↩️ 恢复默认', { cmd: 'cfg', action: 'model-reset' }),
          ]),
        ],
        buttonRow([
          button('➕ 添加 Provider', { cmd: 'cfg', action: 'provider-add' }, 'primary'),
          button('✏️ 修改 Provider', { cmd: 'cfg', action: 'provider-update' }),
          button('🗑 删除 Provider', { cmd: 'cfg', action: 'provider-remove' }, 'danger'),
        ]),
        buttonRow([
          button('🧠 添加模型', { cmd: 'cfg', action: 'model-add' }),
          button('❌ 删除模型', { cmd: 'cfg', action: 'model-remove' }, 'danger'),
          button('🎯 切换模型', { cmd: 'cfg', action: 'model-use' }),
        ]),
        buttonRow([
          button('🏠 设置默认模型', { cmd: 'cfg', action: 'model-default' }),
          button('🔑 设置凭据', { cmd: 'cfg', action: 'key-set' }),
          button('🔓 删除凭据', { cmd: 'cfg', action: 'key-remove' }, 'danger'),
        ]),
        buttonRow([
          button('🔄 刷新', { cmd: 'cfg', action: 'refresh' }),
          button('✖️ 关闭', { cmd: 'cfg', action: 'dismiss' }),
        ]),
      ],
    },
  };
}

/** BotFather-style step card: tap one of the options. */
export function renderWizardOptionsCard(input: WizardOptionsStepCard): object {
  const cancel = button('取消', wizardValue(input.flow, input.step, { cancel: true }));
  const rows: object[] = [];
  for (let index = 0; index < input.options.length; index += 3) {
    rows.push(
      buttonRow(
        input.options
          .slice(index, index + 3)
          .map((option, offset) =>
            button(option.label, wizardValue(input.flow, input.step, { choose: index + offset })),
          ),
      ),
    );
  }
  rows.push(buttonRow([cancel]));
  return {
    schema: '2.0',
    config: {
      summary: { content: '向导 · 选择' },
    },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: [input.question, input.hint ? `\n${input.hint}` : ''].join(''),
        },
        ...rows,
      ],
    },
  };
}

/**
 * BotFather-style step card: type a value into the input. The input and its
 * submit button are wrapped in a `form` container — schema 2.0 only returns
 * input values in the callback when the input lives inside a form.
 */
export function renderWizardTextStepCard(input: WizardTextStepCard): object {
  return {
    schema: '2.0',
    config: {
      summary: { content: '向导 · 输入' },
    },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: [input.question, input.hint ? `\n${input.hint}` : ''].join(''),
        },
        {
          tag: 'form',
          name: `form-${input.flow}-${input.step}`,
          elements: [
            {
              tag: 'input',
              name: 'answer',
              ...(input.required === true ? { required: true } : {}),
              placeholder: { tag: 'plain_text', content: input.placeholder ?? '请输入…' },
            },
            {
              ...button('提交', wizardValue(input.flow, input.step, { submit: true }), 'primary'),
              form_action_type: 'submit',
              name: `btn-submit-${input.flow}-${input.step}`,
            },
          ],
        },
        button('取消', wizardValue(input.flow, input.step, { cancel: true })),
      ],
    },
  };
}

/** Final review card before a write is applied. */
export function renderWizardConfirmStepCard(input: WizardConfirmStepCard): object {
  return {
    schema: '2.0',
    config: {
      summary: { content: '向导 · 确认' },
    },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: `**确认以下内容？**\n\n${input.summary}`,
        },
        buttonRow([
          button(input.confirmLabel ?? '✅ 确认', wizardValue(input.flow, input.step, { confirm: true }), 'primary'),
          button('取消', wizardValue(input.flow, input.step, { cancel: true })),
        ]),
      ],
    },
  };
}
