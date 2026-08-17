import type { CommandChannel } from './index.js';
import type { AccessManager } from '../config/access-manager.js';
import {
  DEEPSEEK_PROVIDER,
  SUPPORTED_PI_AI_PROTOCOLS,
  normalizeBaseUrl,
  type DshProviderManager,
} from '../config/dsh-config.js';
import type { ModelStore } from '../bot/model-store.js';
import type { WizardData, WizardState, WizardStore } from '../bot/wizard-store.js';
import { log } from '../core/logger.js';
import {
  renderConfigHubCard,
  renderWizardConfirmStepCard,
  renderWizardOptionsCard,
  renderWizardTextStepCard,
  type WizardOption,
} from '../card/config-cards.js';

export type ConfigWizardFlowId =
  | 'provider-add'
  | 'provider-update'
  | 'provider-remove'
  | 'model-add'
  | 'model-remove'
  | 'model-use'
  | 'model-default'
  | 'key-set'
  | 'key-remove';

export interface ConfigWizardContext {
  scope: string;
  chatId: string;
  senderId: string;
  channel: CommandChannel;
  dshConfig: DshProviderManager;
  accessManager: AccessManager;
  models: ModelStore;
  wizards: WizardStore;
  /** Bot fallback model (profile preference / env default). */
  defaultModel: string;
}

type StepAnswer = string | string[] | undefined;

export interface WizardFlowStep {
  key: string;
  kind: 'options' | 'text';
  question: string;
  options?:
    | WizardOption[]
    | ((ctx: ConfigWizardContext, data: WizardData) => WizardOption[] | Promise<WizardOption[]>);
  placeholder?: string;
  hint?: string;
  optional?: boolean;
  /** Hide from the final confirm summary. */
  hidden?: boolean;
  /** Skip this step unless the predicate passes. */
  if?: (data: WizardData) => boolean;
  /** Validate / normalize the raw answer; throw Error to re-ask with a message. */
  parse?: (raw: string | string[], data: WizardData) => StepAnswer;
}

export interface WizardFlow {
  id: ConfigWizardFlowId;
  title: string;
  requireAdmin?: boolean;
  confirm?: boolean;
  steps: (ctx: ConfigWizardContext) => Promise<WizardFlowStep[]>;
  summary?: (ctx: ConfigWizardContext, data: WizardData) => Promise<string>;
  execute: (ctx: ConfigWizardContext, data: WizardData) => Promise<string>;
}

const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9._-]*$/;
const CREDENTIAL_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function asString(value: StepAnswer): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asStringList(value: StepAnswer): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

/** Non-empty string field, or undefined. */
function stringField(data: WizardData, key: string): string | undefined {
  const value = data[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function splitCsv(raw: string): string[] {
  const items = raw
    .split(/[,，\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (items.length === 0) throw new Error('至少需要填写一个模型 ID');
  return items;
}

async function providerOptions(ctx: ConfigWizardContext): Promise<WizardOption[]> {
  const providers = await ctx.dshConfig.listProviders();
  return providers
    .filter((provider) => provider.managed)
    .map((provider) => ({
      label: `${provider.displayName}（${provider.id}）`,
      value: provider.id,
    }));
}

async function modelOptions(ctx: ConfigWizardContext): Promise<WizardOption[]> {
  const providers = await ctx.dshConfig.listProviders();
  return providers.flatMap((provider) =>
    provider.models.map((model) => ({
      label: `${model.id}（${provider.id}）`,
      value: model.id,
    })),
  );
}

async function credentialRefOptions(ctx: ConfigWizardContext): Promise<WizardOption[]> {
  const refs = await ctx.dshConfig.listCredentialRefs();
  if (refs.length === 0) {
    throw new Error('凭据文件（.credentials.yaml）中暂无条目');
  }
  return refs.map((ref) => ({ label: ref, value: ref }));
}

function flowSummary(
  ctx: ConfigWizardContext,
  flow: WizardFlow,
  data: WizardData,
): Promise<string> {
  if (flow.summary) return flow.summary(ctx, data);
  return Promise.resolve(
    Object.entries(data)
      .filter(([_key, value]) => value !== undefined)
      .map(([key, value]) => `- **${key}**：${Array.isArray(value) ? value.join('、') : String(value)}`)
      .join('\n'),
  );
}

const FLOWS: Record<ConfigWizardFlowId, WizardFlow> = {
  'provider-add': {
    id: 'provider-add',
    title: '添加自定义 Provider',
    requireAdmin: true,
    confirm: true,
    steps: async (ctx) => {
      const providers = await ctx.dshConfig.listProviders();
      return [
        {
          key: 'api',
          kind: 'options',
          question: '选择 API 协议（OpenAI 兼容网关一般选第一个）',
          options: SUPPORTED_PI_AI_PROTOCOLS.map((protocol) => ({
            label: protocol,
            value: protocol,
          })),
        },
        {
          key: 'id',
          kind: 'text',
          question: '给这个 Provider 起个 ID',
          placeholder: 'kingapi',
          hint: '小写字母开头，仅含 a-z 0-9 . _ -',
          parse: (raw) => {
            const id = asString(raw)?.trim();
            if (!id || !PROVIDER_ID_PATTERN.test(id)) {
              throw new Error('ID 必须是小写字母开头，且仅含 a-z 0-9 . _ -');
            }
            if (providers.some((provider) => provider.id === id)) {
              throw new Error(`provider \`${id}\` 已存在，可用修改向导更新`);
            }
            return id;
          },
        },
        {
          key: 'base-url',
          kind: 'text',
          question: 'Base URL',
          placeholder: 'https://www.kingapi.xyz',
          hint: '形如 https://gateway.example/v1；根域名会自动补全 /v1',
          parse: (raw) => normalizeBaseUrl(asString(raw)?.trim() ?? ''),
        },
        {
          key: 'display-name',
          kind: 'text',
          question: '显示名称（可选）',
          placeholder: 'KingAI',
          optional: true,
          parse: (raw) => {
            const name = asString(raw)?.trim();
            return name ? name : undefined;
          },
        },
        {
          key: 'models',
          kind: 'text',
          question: '模型 ID（多个用逗号分隔）',
          placeholder: 'doubao-seed-2-0-lite-260428, doubao-1.5-pro',
          parse: (raw) => splitCsv(asString(raw) ?? ''),
        },
        {
          key: 'api-key-env',
          kind: 'text',
          question: 'API Key 引用名（可选）',
          placeholder: 'KINGAI_API_KEY',
          hint: 'settings 只保存引用名（通常可直接用 provider ID，如 kingapi）；密钥值下一步单独输入',
          optional: true,
          parse: (raw) => {
            const ref = asString(raw)?.trim();
            if (!ref) return undefined;
            if (!CREDENTIAL_REF_PATTERN.test(ref)) {
              throw new Error('引用名应为环境变量名（字母/数字/下划线，字母开头）');
            }
            return ref;
          },
        },
        {
          key: 'set-key-now',
          kind: 'options',
          hidden: true,
          if: (data) => Boolean(data['api-key-env']),
          question: '现在就设置密钥值吗？',
          options: [
            { label: '🔑 现在设置', value: 'now' },
            { label: '稍后 /key set', value: 'later' },
          ],
        },
        {
          key: 'api-key-value',
          kind: 'text',
          hidden: true,
          if: (data) => data['set-key-now'] === 'now',
          question: '粘贴 API Key 值',
          placeholder: 'sk-…',
          hint: '⚠️ 群聊中输入的密钥对群成员可见，建议私聊操作；回复中不会回显',
          parse: (raw) => {
            const value = asString(raw)?.trim();
            if (!value) throw new Error('密钥值不能为空');
            return value;
          },
        },
      ];
    },
    summary: async (_ctx, data) => {
      const lines = [
        `协议：\`${asString(data.api)}\``,
        `ID：\`${asString(data.id)}\``,
        `Base URL：\`${asString(data['base-url'])}\``,
        ...(data['display-name'] ? [`显示名称：\`${asString(data['display-name'])}\``] : []),
        `模型：${asStringList(data.models).map((id) => `\`${id}\``).join('、')}`,
        data['api-key-env']
          ? `凭据引用：\`${asString(data['api-key-env'])}\`${data['api-key-value'] ? '（本次写入值）' : '（未写入值）'}`
          : '凭据：暂不关联',
      ];
      return lines.join('\n');
    },
    execute: async (ctx, data) => {
      const id = asString(data.id)!;
      const displayName = stringField(data, 'display-name');
      const apiKeyEnv = stringField(data, 'api-key-env');
      const models = asStringList(data.models).map((modelId) => ({
        id: modelId,
        name: undefined,
        contextWindow: undefined,
        maxTokens: undefined,
      }));
      await ctx.dshConfig.upsertPiAiProvider({
        id,
        ...(displayName === undefined ? {} : { displayName }),
        ...(apiKeyEnv === undefined ? {} : { apiKeyEnv }),
        api: asString(data.api)!,
        baseURL: asString(data['base-url'])!,
        models,
      });
      const apiKeyValue = stringField(data, 'api-key-value');
      if (apiKeyEnv && apiKeyValue) {
        await ctx.dshConfig.setCredential(
          apiKeyEnv,
          apiKeyValue,
        );
      }
      const credentialNote =
        apiKeyEnv && apiKeyValue
          ? `凭据已写入 \`.credentials.yaml\`（值已隐藏）`
          : apiKeyEnv
            ? `凭据引用 \`${apiKeyEnv}\` 已关联，值请用 /key set 写入`
            : '尚未关联凭据';
      return [
        `✅ 已添加 provider：\`${id}\`（协议 \`${asString(data.api)}\`，模型 ${models.length} 个）。`,
        '',
        `${credentialNote}。`,
        '配置已写入 settings.yaml，下一请求即生效，无需重启 bot。',
      ].join('\n');
    },
  },

  'provider-update': {
    id: 'provider-update',
    title: '修改 Provider',
    requireAdmin: true,
    confirm: true,
    steps: async (ctx) => [
      {
        key: 'provider',
        kind: 'options',
        question: '选择要修改的 Provider',
        options: await providerOptions(ctx),
      },
      {
        key: 'field',
        kind: 'options',
        question: '修改哪个字段？',
        options: async (_ctx, data) => {
          const providerId = asString(data.provider);
          if (providerId === DEEPSEEK_PROVIDER) {
            return [
              { label: 'Base URL', value: 'base-url' },
              { label: 'API Key 引用名', value: 'api-key-env' },
            ];
          }
          return [
            { label: '显示名称', value: 'display-name' },
            { label: 'API 协议', value: 'api' },
            { label: 'Base URL', value: 'base-url' },
            { label: '模型列表', value: 'models' },
            { label: 'API Key 引用名', value: 'api-key-env' },
          ];
        },
      },
      {
        key: 'value',
        kind: 'text',
        if: (data) => Boolean(data.field),
        question: '输入新值',
        placeholder: '…',
        parse: (raw, data) => {
          const field = asString(data.field);
          if (field === 'base-url') {
            const url = asString(raw)?.trim() ?? '';
            if (!url) throw new Error('Base URL 不能为空');
            // The llm-deepseek adapter expects the official root base URL
            // (it appends its own API paths); only pi-ai gateways get the
            // bare-origin -> /v1 normalization.
            if (asString(data.provider) === DEEPSEEK_PROVIDER) {
              normalizeBaseUrl(url); // validate protocol, keep the raw value
              return url;
            }
            return normalizeBaseUrl(url);
          }
          if (field === 'models') return splitCsv(asString(raw) ?? '');
          if (field === 'api') {
            const protocol = asString(raw)?.trim();
            if (!protocol || !(SUPPORTED_PI_AI_PROTOCOLS as readonly string[]).includes(protocol)) {
              throw new Error(`协议必须是 ${SUPPORTED_PI_AI_PROTOCOLS.join(' / ')}`);
            }
            return protocol;
          }
          const text = asString(raw)?.trim();
          if (!text) throw new Error('不能为空');
          if (field === 'api-key-env' && !CREDENTIAL_REF_PATTERN.test(text)) {
            throw new Error('引用名应为环境变量名（字母/数字/下划线，字母开头）');
          }
          return text;
        },
      },
    ],
    summary: (_ctx, data) =>
      Promise.resolve(
        `Provider：\`${asString(data.provider)}\`\n字段：\`${asString(data.field)}\`\n新值：${Array.isArray(data.value) ? asStringList(data.value).map((id) => `\`${id}\``).join('、') : `\`${asString(data.value)}\``}`,
      ),
    execute: async (ctx, data) => {
      const providerId = asString(data.provider)!;
      const field = asString(data.field)!;
      const baseURL = stringField(data, 'value');
      const apiKeyEnv = stringField(data, 'value');
      const displayName = stringField(data, 'value');
      const api = stringField(data, 'value');
      if (providerId === DEEPSEEK_PROVIDER) {
        await ctx.dshConfig.upsertDeepseekProvider({
          ...(field === 'base-url' && baseURL ? { baseURL } : {}),
          ...(field === 'api-key-env' && apiKeyEnv ? { apiKeyEnv } : {}),
        });
      } else {
        await ctx.dshConfig.upsertPiAiProvider({
          id: providerId,
          ...(field === 'display-name' && displayName ? { displayName } : {}),
          ...(field === 'api' && api ? { api } : {}),
          ...(field === 'base-url' && baseURL ? { baseURL } : {}),
          ...(field === 'api-key-env' && apiKeyEnv ? { apiKeyEnv } : {}),
          ...(field === 'models'
            ? {
                models: asStringList(data.value).map((modelId) => ({
                  id: modelId,
                  name: undefined,
                  contextWindow: undefined,
                  maxTokens: undefined,
                })),
              }
            : {}),
        });
      }
      return `已更新 provider \`${providerId}\` 的 \`${field}\`（settings.yaml 已更新，下一请求生效）。`;
    },
  },

  'provider-remove': {
    id: 'provider-remove',
    title: '删除 Provider',
    requireAdmin: true,
    confirm: true,
    steps: async (ctx) => [
      {
        key: 'provider',
        kind: 'options',
        question: '选择要删除的 Provider（删除后不可恢复）',
        options: await providerOptions(ctx),
      },
    ],
    summary: (_ctx, data) =>
      Promise.resolve(`将删除 provider：\`${asString(data.provider)}\`\n\n⚠️ 该操作会立即修改 settings.yaml${asString(data.provider) === DEEPSEEK_PROVIDER ? '，并移除对应凭据' : ''}，请确认。`),
    execute: async (ctx, data) => {
      const id = asString(data.provider)!;
      if (id === DEEPSEEK_PROVIDER) {
        await ctx.dshConfig.removeDeepseekProvider();
        return `已删除 provider：\`${id}\`（含 llm-deepseek 段及对应凭据）。`;
      }
      const removed = await ctx.dshConfig.removePiAiProvider(id);
      return removed
        ? `已删除 provider：\`${id}\`（settings.yaml 已更新，下一请求生效）。`
        : `未找到 provider：\`${id}\`。`;
    },
  },

  'model-add': {
    id: 'model-add',
    title: '添加模型',
    requireAdmin: true,
    confirm: true,
    steps: async (ctx) => [
      {
        key: 'provider',
        kind: 'options',
        question: '把模型加到哪个 Provider？',
        options: await providerOptions(ctx),
      },
      {
        key: 'models',
        kind: 'text',
        question: '模型 ID（多个用逗号分隔）',
        placeholder: 'doubao-seed-2-0-lite-260428',
        parse: (raw) => splitCsv(asString(raw) ?? ''),
      },
      {
        key: 'name',
        kind: 'text',
        question: '显示名称（可选，留空用 ID）',
        placeholder: 'Doubao Seed 2.0 Lite',
        optional: true,
        parse: (raw) => {
          const name = asString(raw)?.trim();
          return name ? name : undefined;
        },
      },
    ],
    summary: (_ctx, data) =>
      Promise.resolve(
        `Provider：\`${asString(data.provider)}\`\n模型：${asStringList(data.models).map((id) => `\`${id}\``).join('、')}${data.name ? `\n名称：\`${asString(data.name)}\`` : ''}`,
      ),
    execute: async (ctx, data) => {
      const providerId = asString(data.provider)!;
      const name = asString(data.name);
      let added = 0;
      for (const modelId of asStringList(data.models)) {
        const entry = { id: modelId, name, contextWindow: undefined, maxTokens: undefined };
        if (providerId === DEEPSEEK_PROVIDER) {
          await ctx.dshConfig.addDeepseekModel(entry);
        } else {
          await ctx.dshConfig.addPiAiModel(providerId, entry);
        }
        added += 1;
      }
      return `已添加 ${added} 个模型到 \`${providerId}\`（settings.yaml 已更新，下一请求生效）。`;
    },
  },

  'model-remove': {
    id: 'model-remove',
    title: '删除模型',
    requireAdmin: true,
    confirm: true,
    steps: async (ctx) => {
      const providers = await ctx.dshConfig.listProviders();
      return [
        {
          key: 'provider',
          kind: 'options',
          question: '从哪个 Provider 删除？',
          options: providers
            .filter((provider) => provider.models.length > 0)
            .map((provider) => ({
              label: `${provider.displayName}（${provider.id}）`,
              value: provider.id,
            })),
        },
        {
          key: 'model',
          kind: 'options',
          if: (data) => Boolean(data.provider),
          question: '选择要删除的模型',
          options: async (ctx, data) => {
            const providers = await ctx.dshConfig.listProviders();
            const provider = providers.find((entry) => entry.id === asString(data.provider));
            return (provider?.models ?? []).map((model) => ({
              label: model.id,
              value: model.id,
            }));
          },
        },
      ];
    },
    summary: (_ctx, data) =>
      Promise.resolve(
        `Provider：\`${asString(data.provider)}\`\n模型：\`${asString(data.model)}\``,
      ),
    execute: async (ctx, data) => {
      const providerId = asString(data.provider)!;
      const modelId = asString(data.model)!;
      const removed =
        providerId === DEEPSEEK_PROVIDER
          ? await ctx.dshConfig.removeDeepseekModel(modelId)
          : await ctx.dshConfig.removePiAiModel(providerId, modelId);
      return removed
        ? `已删除模型：\`${providerId}\` → \`${modelId}\`。`
        : `未找到模型：\`${modelId}\`（provider \`${providerId}\`）。`;
    },
  },

  'model-use': {
    id: 'model-use',
    title: '切换当前会话模型',
    steps: async (ctx) => [
      {
        key: 'model',
        kind: 'options',
        question: '选择当前会话要使用的模型',
        options: await modelOptions(ctx),
      },
    ],
    execute: async (ctx, data) => {
      const id = asString(data.model)!;
      ctx.models.set(ctx.scope, id);
      return `已热切换当前会话模型：\`${id}\`（下一轮消息生效，无需重启 bot）。`;
    },
  },

  'model-default': {
    id: 'model-default',
    title: '设置 dsh 默认模型',
    requireAdmin: true,
    confirm: true,
    steps: async (ctx) => [
      {
        key: 'model',
        kind: 'options',
        question: '选择 dsh 默认模型（agent-default-model）',
        options: await modelOptions(ctx),
      },
    ],
    summary: (_ctx, data) => Promise.resolve(`将写入 dsh 默认模型：\`${asString(data.model)}\``),
    execute: async (ctx, data) => {
      await ctx.dshConfig.setDefaultModel(asString(data.model)!);
      return `已写入 dsh 默认模型（agent-default-model）：\`${asString(data.model)}\`，新会话生效。`;
    },
  },

  'key-set': {
    id: 'key-set',
    title: '设置凭据',
    requireAdmin: true,
    confirm: true,
    steps: async () => [
      {
        key: 'ref',
        kind: 'text',
        question: '凭据引用名',
        placeholder: 'KINGAI_API_KEY',
        hint: '环境变量名：字母/数字/下划线，字母开头',
        parse: (raw) => {
          const ref = asString(raw)?.trim();
          if (!ref || !CREDENTIAL_REF_PATTERN.test(ref)) {
            throw new Error('引用名应为环境变量名（字母/数字/下划线，字母开头）');
          }
          return ref;
        },
      },
      {
        key: 'value',
        kind: 'text',
        question: '粘贴密钥值',
        placeholder: 'sk-…',
        hint: '⚠️ 群聊中输入的密钥对群成员可见，建议私聊操作；回复中不会回显',
        parse: (raw) => {
          const value = asString(raw)?.trim();
          if (!value) throw new Error('密钥值不能为空');
          return value;
        },
      },
    ],
    summary: (_ctx, data) =>
      Promise.resolve(`凭据引用：\`${asString(data.ref)}\`\n值：**（已隐藏）**`),
    execute: async (ctx, data) => {
      const ref = asString(data.ref)!;
      const value = asString(data.value)!;
      await ctx.dshConfig.setCredential(ref, value);
      const providers = await ctx.dshConfig.listProviders();
      const target = providers.find(
        (provider) =>
          provider.id === ref &&
          provider.namespace === 'llm-pi-ai' &&
          provider.credentialRef === undefined,
      );
      let autoLinked = false;
      if (target) {
        await ctx.dshConfig.upsertPiAiProvider({ id: ref, apiKeyEnv: ref });
        autoLinked = true;
      }
      return [
        `已写入凭据 \`${ref}\` 到 \`~/.dsh/.credentials.yaml\`（0600，值已隐藏）。建议在私聊中使用；群聊里粘贴的密钥会对群成员可见。`,
        ...(autoLinked
          ? [
              '',
              `🔗 已自动把 provider \`${ref}\` 的 apiKeyEnv 关联到 \`${ref}\`（下一请求生效）。`,
            ]
          : []),
      ].join('\n');
    },
  },

  'key-remove': {
    id: 'key-remove',
    title: '删除凭据',
    requireAdmin: true,
    confirm: true,
    steps: async (ctx) => [
      {
        key: 'ref',
        kind: 'options',
        question: '选择要删除的凭据引用',
        options: await credentialRefOptions(ctx).catch(() => []),
      },
    ],
    summary: (_ctx, data) => Promise.resolve(`将删除凭据引用：\`${asString(data.ref)}\``),
    execute: async (ctx, data) => {
      const ref = asString(data.ref)!;
      const removed = await ctx.dshConfig.removeCredential(ref);
      return removed ? `已删除凭据 \`${ref}\`。` : `未找到凭据 \`${ref}\`。`;
    },
  },
};

async function stepOptions(
  step: WizardFlowStep | undefined,
  ctx: ConfigWizardContext,
  data: WizardData,
): Promise<WizardOption[] | undefined> {
  if (!step) return undefined;
  if (typeof step.options === 'function') {
    return step.options(ctx, data);
  }
  return step.options;
}

async function nextPendingStep(
  steps: WizardFlowStep[],
  data: WizardData,
  from: number,
): Promise<number> {
  let index = from;
  while (index < steps.length) {
    const step = steps[index];
    if (!step?.if || step.if(data)) return index;
    index += 1;
  }
  return steps.length;
}

async function renderCurrentStep(ctx: ConfigWizardContext, state: WizardState): Promise<void> {
  const flow = FLOWS[state.flow as ConfigWizardFlowId];
  if (!flow) {
    ctx.wizards.clear(ctx.scope);
    await ctx.channel.sendMarkdown(ctx.chatId, '⚠️ 未知的向导流程，已取消。');
    return;
  }
  const steps = await flow.steps(ctx);
  const step = steps[state.step];
  if (!step) {
    await finalize(ctx, state, flow);
    return;
  }
  const options = await stepOptions(step, ctx, state.data);
  if (step.kind === 'options' && options) {
    if (ctx.channel.sendCard) {
      try {
        await ctx.channel.sendCard(
          ctx.chatId,
          renderWizardOptionsCard({
            flow: flow.id,
            step: state.step,
            question: step.question,
            options,
            ...(step.hint === undefined ? {} : { hint: step.hint }),
          }),
        );
        return;
      } catch (error) {
        log.warn('wizard', 'card-send-failed', {
          flow: flow.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const labels = options.map((option) => `\`${option.label}\``).join('、');
    await ctx.channel.sendMarkdown(
      ctx.chatId,
      `【${flow.title}】${step.question}\n\n${labels}\n\n（当前环境不支持交互卡片，请用文字命令完成该操作）`,
    );
    return;
  }
  if (ctx.channel.sendCard) {
    try {
      await ctx.channel.sendCard(
        ctx.chatId,
        renderWizardTextStepCard({
          flow: flow.id,
          step: state.step,
          question: step.question,
          ...(step.optional === true ? {} : { required: true }),
          ...(step.placeholder === undefined ? {} : { placeholder: step.placeholder }),
          ...(step.hint === undefined ? {} : { hint: step.hint }),
        }),
      );
      return;
    } catch (error) {
      log.warn('wizard', 'card-send-failed', {
        flow: flow.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  await ctx.channel.sendMarkdown(
    ctx.chatId,
    `【${flow.title}】${step.question}\n\n（当前环境不支持交互卡片，请用文字命令完成该操作）`,
  );
}

async function finalize(ctx: ConfigWizardContext, state: WizardState, flow: WizardFlow): Promise<void> {
  if (flow.requireAdmin && !ctx.accessManager.isAdmin(ctx.senderId)) {
    ctx.wizards.clear(ctx.scope);
    await ctx.channel.sendMarkdown(ctx.chatId, '仅管理员可执行该操作，向导已取消。');
    return;
  }
  try {
    const text = await flow.execute(ctx, state.data);
    ctx.wizards.clear(ctx.scope);
    await ctx.channel.sendMarkdown(ctx.chatId, text);
    if (flow.requireAdmin && ctx.channel.sendCard) {
      try {
        await showConfigHub(ctx);
      } catch (error) {
        // The write already succeeded; a hub refresh failure must not surface
        // as a failed operation.
        await ctx.channel.sendMarkdown(
          ctx.chatId,
          `（管理卡片刷新失败：${error instanceof Error ? error.message : String(error)}）`,
        );
      }
    }
  } catch (error) {
    ctx.wizards.clear(ctx.scope);
    const message = error instanceof Error ? error.message : String(error);
    await ctx.channel.sendMarkdown(ctx.chatId, `⚠️ 操作失败：${message}`);
  }
}

export async function beginWizard(ctx: ConfigWizardContext, flowId: ConfigWizardFlowId): Promise<void> {
  const flow = FLOWS[flowId];
  if (!flow) return;
  if (flow.requireAdmin && !ctx.accessManager.isAdmin(ctx.senderId)) {
    await ctx.channel.sendMarkdown(ctx.chatId, '仅管理员可执行该操作。');
    return;
  }
  ctx.wizards.begin(ctx.scope, flowId);
  const state = ctx.wizards.get(ctx.scope)!;
  const steps = await flow.steps(ctx);
  state.step = await nextPendingStep(steps, state.data, 0);
  ctx.wizards.set(ctx.scope, state);
  await renderCurrentStep(ctx, state);
}

async function storeAnswerAndAdvance(
  ctx: ConfigWizardContext,
  state: WizardState,
  rawAnswer: StepAnswer,
): Promise<void> {
  const flow = FLOWS[state.flow as ConfigWizardFlowId];
  const steps = await flow!.steps(ctx);
  const step = steps[state.step];
  if (!step) return;
  let answer: StepAnswer = rawAnswer;
  if (step.parse) {
    try {
      answer = step.parse(rawAnswer ?? '', state.data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.channel.sendMarkdown(ctx.chatId, `⚠️ ${message}，请重新填写：`);
      await renderCurrentStep(ctx, state);
      return;
    }
  }
  if (answer === undefined && !step.optional) {
    await ctx.channel.sendMarkdown(ctx.chatId, '⚠️ 该项不能为空，请重新填写：');
    await renderCurrentStep(ctx, state);
    return;
  }
  state.data = { ...state.data, [step.key]: answer };
  state.step = await nextPendingStep(steps, state.data, state.step + 1);
  ctx.wizards.set(ctx.scope, state);
  if (state.step >= steps.length) {
    if (flow!.confirm) {
      const summary = await flowSummary(ctx, flow!, state.data);
      if (ctx.channel.sendCard) {
        await ctx.channel.sendCard(
          ctx.chatId,
          renderWizardConfirmStepCard({
            flow: flow!.id,
            step: state.step,
            summary,
          }),
        );
      } else {
        await ctx.channel.sendMarkdown(ctx.chatId, `【确认】\n\n${summary}`);
      }
      return;
    }
    await finalize(ctx, state, flow!);
    return;
  }
  await renderCurrentStep(ctx, state);
}

/** Route a card action whose `value.cmd === 'wizard'`. */
export async function handleWizardCardAction(
  value: Record<string, unknown>,
  formValue: Record<string, unknown> | undefined,
  ctx: ConfigWizardContext,
): Promise<void> {
  const flowId = value.flow as ConfigWizardFlowId;
  const step = typeof value.step === 'number' ? value.step : Number(value.step);
  const state = ctx.wizards.get(ctx.scope);
  if (!state || state.flow !== flowId || state.step !== step) {
    await ctx.channel.sendMarkdown(
      ctx.chatId,
      '⚠️ 该向导已失效或已过期（30 分钟无操作自动取消），请重新发起。',
    );
    return;
  }
  if (value.cancel !== undefined) {
    ctx.wizards.clear(ctx.scope);
    await ctx.channel.sendMarkdown(ctx.chatId, '已取消。');
    return;
  }
  if (value.confirm !== undefined) {
    await finalize(ctx, state, FLOWS[flowId]);
    return;
  }
  if (value.choose !== undefined) {
    const flow = FLOWS[flowId];
    const steps = await flow.steps(ctx);
    const options = await stepOptions(steps[step], ctx, state.data);
    const index = Number(value.choose);
    const option = options?.[index];
    if (!option) {
      await ctx.channel.sendMarkdown(ctx.chatId, '⚠️ 选项已失效，请重新选择。');
      await renderCurrentStep(ctx, state);
      return;
    }
    await storeAnswerAndAdvance(ctx, state, option.value);
    return;
  }
  if (value.submit !== undefined) {
    await storeAnswerAndAdvance(ctx, state, formValue?.answer as StepAnswer);
    return;
  }
}

export async function showConfigHub(ctx: ConfigWizardContext): Promise<void> {
  const providers = await ctx.dshConfig.listProviders();
  const defaultSelection = await ctx.dshConfig.defaultModelSelection();
  const currentModel = ctx.models.get(ctx.scope) ?? ctx.defaultModel;
  if (ctx.channel.sendCard) {
    try {
      await ctx.channel.sendCard(
        ctx.chatId,
        renderConfigHubCard({ providers, defaultSelection, currentModel }),
      );
      return;
    } catch (error) {
      log.warn('wizard', 'hub-card-send-failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const lines = providers.map((provider) => {
    const models = provider.models.map((model) => model.id).join(', ') || '(无)';
    return `- **${provider.id}**（${provider.displayName}）· ${provider.credentialReady ? '凭据就绪' : '凭据缺失'}：${models}`;
  });
  await ctx.channel.sendMarkdown(
    ctx.chatId,
    ['**Provider / 模型 / 凭据管理**', '', ...lines, '', '当前环境不支持交互卡片，请用 `/provider` `/model` `/key` 文字命令。'].join('\n'),
  );
}

/** Route a hub card action whose `value.cmd === 'cfg'`. */
export async function handleConfigHubAction(
  action: string,
  ctx: ConfigWizardContext,
): Promise<void> {
  switch (action) {
    case 'refresh':
      await showConfigHub(ctx);
      return;
    case 'dismiss':
      return;
    case 'provider-add':
    case 'provider-update':
    case 'provider-remove':
    case 'model-add':
    case 'model-remove':
    case 'model-use':
    case 'model-default':
    case 'key-set':
    case 'key-remove':
      await beginWizard(ctx, action as ConfigWizardFlowId);
      return;
    default:
      await ctx.channel.sendMarkdown(ctx.chatId, '未知操作。');
  }
}
