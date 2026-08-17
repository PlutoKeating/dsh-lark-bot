import type { DshProviderSummary } from '../config/dsh-config.js';

export interface ConfigHubInput {
  providers: DshProviderSummary[];
  defaultSelection: { provider: string; model: string } | undefined;
  currentModel: string;
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

function actionRow(actions: object[]): object {
  return { tag: 'action', actions };
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
        actionRow([
          button('➕ 添加 Provider', { cmd: 'cfg', action: 'provider-add' }, 'primary'),
          button('✏️ 修改 Provider', { cmd: 'cfg', action: 'provider-update' }),
          button('🗑 删除 Provider', { cmd: 'cfg', action: 'provider-remove' }, 'danger'),
        ]),
        actionRow([
          button('🧠 添加模型', { cmd: 'cfg', action: 'model-add' }),
          button('❌ 删除模型', { cmd: 'cfg', action: 'model-remove' }, 'danger'),
          button('🎯 切换模型', { cmd: 'cfg', action: 'model-use' }),
        ]),
        actionRow([
          button('🏠 设置默认模型', { cmd: 'cfg', action: 'model-default' }),
          button('🔑 设置凭据', { cmd: 'cfg', action: 'key-set' }),
          button('🔓 删除凭据', { cmd: 'cfg', action: 'key-remove' }, 'danger'),
        ]),
        actionRow([
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
      actionRow(
        input.options
          .slice(index, index + 3)
          .map((option, offset) =>
            button(option.label, wizardValue(input.flow, input.step, { choose: index + offset })),
          ),
      ),
    );
  }
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
        actionRow([cancel]),
      ],
    },
  };
}

/** BotFather-style step card: type a value into the input. */
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
          tag: 'input',
          name: 'answer',
          placeholder: { tag: 'plain_text', content: input.placeholder ?? '请输入…' },
        },
        actionRow([
          button('提交', wizardValue(input.flow, input.step, { submit: true }), 'primary'),
          button('取消', wizardValue(input.flow, input.step, { cancel: true })),
        ]),
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
        actionRow([
          button(input.confirmLabel ?? '✅ 确认', wizardValue(input.flow, input.step, { confirm: true }), 'primary'),
          button('取消', wizardValue(input.flow, input.step, { cancel: true })),
        ]),
      ],
    },
  };
}
