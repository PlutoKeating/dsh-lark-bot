import type { DshModelEntry, DshProviderSummary } from '../config/dsh-config.js';
import {
  DEEPSEEK_PROVIDER,
  PIAI_NAMESPACE,
  SUPPORTED_PI_AI_PROTOCOLS,
} from '../config/dsh-config.js';
import type { CommandContext } from './index.js';
import { bilingualMarkdown } from '../card/i18n.js';

interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | undefined>;
  repeated: Record<string, string[]>;
}

function parseArgs(input: string): ParsedArgs {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  const positionals: string[] = [];
  const flags: Record<string, string | undefined> = {};
  const repeated: Record<string, string[]> = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? '';
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const name = token.slice(2);
    const next = tokens[index + 1];
    let value: string | undefined;
    if (next !== undefined && !next.startsWith('--')) {
      value = next;
      index += 1;
    }
    flags[name] = value;
    if (value !== undefined) {
      const list = repeated[name] ?? [];
      list.push(value);
      repeated[name] = list;
    }
  }
  return { positionals, flags, repeated };
}

async function reply(ctx: CommandContext, zhCn: string, enUs: string): Promise<void> {
  await ctx.channel.sendMarkdown(ctx.chatId, bilingualMarkdown(zhCn, enUs), {
    replyTo: ctx.messageId,
  });
}

function requireAdmin(ctx: CommandContext): boolean {
  if (!ctx.accessManager.isAdmin(ctx.senderId)) {
    void reply(ctx, '仅管理员可执行该操作。', 'Only admins can perform this operation.');
    return false;
  }
  return true;
}

function formatModel(model: { id: string; name: string | undefined }): string {
  return model.name ? `\`${model.id}\` (${model.name})` : `\`${model.id}\``;
}

function credentialLabel(provider: DshProviderSummary): string {
  if (provider.credentialReady) return '凭据就绪';
  return provider.credentialRef === undefined ? '未配置凭据' : '凭据缺失';
}

function formatProviders(providers: readonly DshProviderSummary[]): string {
  const lines = providers.map((provider) => {
    const state = provider.configured ? '已配置' : '未配置';
    const models = provider.models.length > 0
      ? provider.models.map((model) => model.id).join(', ')
      : '(无)';
    return `- **${provider.id}** (${provider.displayName}) — ${state} · ${credentialLabel(provider)}\n  models: ${models}`;
  });
  return lines.join('\n');
}

async function resolveModelSelection(
  ctx: CommandContext,
  selection: string,
): Promise<{ provider: string; model: string } | undefined> {
  return ctx.dshConfig.resolveModelRoute(selection);
}

function deepseekModelInput(args: {
  id: string;
  flags: Record<string, string | undefined>;
}): DshModelEntry {
  const rawModalities = args.flags['input-modalities'];
  const inputModalities = rawModalities === undefined
    ? undefined
    : rawModalities.split(',').map((value) => value.trim()).filter(Boolean);
  if (inputModalities?.some((value) => value !== 'text' && value !== 'image')) {
    throw new Error('--input-modalities 仅支持逗号分隔的 text,image');
  }
  return {
    id: args.id,
    name: args.flags.name,
    contextWindow: undefined,
    maxTokens: undefined,
    inputModalities: inputModalities as Array<'text' | 'image'> | undefined,
  };
}

export async function handleModel(args: string, ctx: CommandContext): Promise<void> {
  const { positionals, flags } = parseArgs(args);
  const [sub, ...rest] = positionals;

  if (!sub) {
    const override = ctx.models.get(ctx.scope);
    const active = override ?? ctx.defaultModel;
    const dshDefault = await ctx.dshConfig.defaultModelSelection();
    const providers = await ctx.dshConfig.listProviders();
    const modelLines = providers.flatMap((provider) =>
      provider.models.map((model) => `- ${formatModel(model)} ← ${provider.id}`),
    );
    await reply(
      ctx,
      [
        `**当前会话模型**：\`${active}\`${override ? `（会话级；bot 重启后回落到 \`${ctx.defaultModel}\`）` : '（默认来源）'}`,
        `**dsh 默认模型**（agent-default-model）：${dshDefault ? `\`${dshDefault.model}\`（provider \`${dshDefault.provider}\`）` : '(未设置)'}`,
        `**bot 回退默认**（profile / DSH_LARK_MODEL）：\`${ctx.defaultModel}\``,
        '',
        '**可用模型**（dsh 已配置）：',
        ...(modelLines.length > 0 ? modelLines : ['（暂无）']),
        '',
        '用法：`/model use <provider/model>`（也兼容唯一模型 ID）、`/model default <id>`、`/model reset`、`/model add|remove <provider> <modelId> [--name <name>] [--input-modalities text,image]`',
      ].join('\n'),
      [
        `**Current session model**: \`${active}\`${override ? ` (session override; falls back to \`${ctx.defaultModel}\` after a bot restart)` : ' (default source)'}`,
        `**dsh default model** (agent-default-model): ${dshDefault ? `\`${dshDefault.model}\` (provider \`${dshDefault.provider}\`)` : '(not set)'}`,
        `**Bot fallback default** (profile / DSH_LARK_MODEL): \`${ctx.defaultModel}\``,
        '',
        '**Available models** (configured in dsh):',
        ...(modelLines.length > 0 ? modelLines : ['(none)']),
        '',
        'Usage: `/model use <provider/model>` (a unique bare model ID also works), `/model default <id>`, `/model reset`, or `/model add|remove <provider> <modelId> [--name <name>] [--input-modalities text,image]`',
      ].join('\n'),
    );
    return;
  }

  if (sub === 'use') {
    const id = rest.join(' ').trim();
    if (!id) {
      await reply(ctx, '用法：`/model use <provider/model>`（也兼容唯一模型 ID）', 'Usage: `/model use <provider/model>` (a unique bare model ID also works)');
      return;
    }
    const route = await resolveModelSelection(ctx, id);
    if (!route) {
      await reply(ctx, `未找到模型 \`${id}\`，可用 /model 查看列表。`, `Model \`${id}\` was not found. Use /model to list models.`);
      return;
    }
    const selection = id.includes('/') ? `${route.provider}/${route.model}` : route.model;
    ctx.models.set(ctx.scope, selection);
    await reply(ctx, `已热切换当前会话模型：\`${selection}\`（下一轮消息生效）。这是内存中的会话级覆盖；bot 重启后会回落到 \`${ctx.defaultModel}\`，长期固定请用 \`/model default\`。`, `Switched this session to \`${selection}\` for the next message. This in-memory session override falls back to \`${ctx.defaultModel}\` after a bot restart; use \`/model default\` for a persistent default.`);
    return;
  }

  if (sub === 'reset') {
    const cleared = ctx.models.clear(ctx.scope);
    await reply(ctx, cleared ? '已清除当前会话模型覆盖，恢复 bot 默认模型。' : '当前会话没有模型覆盖。', cleared ? 'Cleared this session’s model override and restored the bot default.' : 'This session has no model override.');
    return;
  }

  if (sub === 'default') {
    const id = rest.join(' ').trim();
    if (!id) {
      await reply(ctx, '用法：`/model default <modelId>`', 'Usage: `/model default <modelId>`');
      return;
    }
    const route = await resolveModelSelection(ctx, id);
    if (!route) {
      await reply(ctx, `未找到模型 \`${id}\`，可用 /model 查看列表。`, `Model \`${id}\` was not found. Use /model to list models.`);
      return;
    }
    if (!requireAdmin(ctx)) return;
    await ctx.dshConfig.setDefaultModel(id);
    await ctx.setDefaultModelPreference?.(id);
    await reply(
      ctx,
      `已写入 dsh 默认模型（agent-default-model）：\`${id}\`（同时更新 profile 默认模型），新会话生效。`,
      `Set the dsh default model (agent-default-model) to \`${id}\` and updated the profile default. New sessions will use it.`,
    );
    return;
  }

  if (sub === 'add' || sub === 'remove') {
    if (!requireAdmin(ctx)) return;
    const providerId = rest[0];
    const id = rest[1];
    if (!providerId || !id) {
      await reply(ctx, `用法：\`/model ${sub} <provider> <modelId> [--name <name>] [--input-modalities text,image]\``, `Usage: \`/model ${sub} <provider> <modelId> [--name <name>] [--input-modalities text,image]\``);
      return;
    }
    if (sub === 'add') {
      if (providerId === DEEPSEEK_PROVIDER) {
        await ctx.dshConfig.addDeepseekModel(deepseekModelInput({ id, flags }));
        await reply(ctx, `已添加模型：\`${providerId}\` → \`${id}\`（settings.yaml 已更新，下一请求生效）。`, `Added model \`${providerId}\` → \`${id}\`. settings.yaml was updated; the next request will use it.`);
      } else {
        await ctx.dshConfig.addPiAiModel(providerId, deepseekModelInput({ id, flags }));
        await reply(ctx, `已添加模型：\`${providerId}\` → \`${id}\`（settings.yaml 已更新，下一请求生效）。`, `Added model \`${providerId}\` → \`${id}\`. settings.yaml was updated; the next request will use it.`);
      }
    } else if (providerId === DEEPSEEK_PROVIDER) {
      const removed = await ctx.dshConfig.removeDeepseekModel(id);
      await reply(ctx, removed ? `已删除模型：\`${providerId}\` → \`${id}\`。` : `未找到模型：\`${id}\`。`, removed ? `Removed model \`${providerId}\` → \`${id}\`.` : `Model not found: \`${id}\`.`);
    } else {
      const removed = await ctx.dshConfig.removePiAiModel(providerId, id);
      await reply(ctx, removed ? `已删除模型：\`${providerId}\` → \`${id}\`。` : `未找到模型：\`${id}\`。`, removed ? `Removed model \`${providerId}\` → \`${id}\`.` : `Model not found: \`${id}\`.`);
    }
    return;
  }

  await reply(ctx, '未知 `/model` 子命令，请使用 use / default / reset / add / remove。', 'Unknown `/model` subcommand. Use use / default / reset / add / remove.');
}

export async function handleProviders(_args: string, ctx: CommandContext): Promise<void> {
  const providers = await ctx.dshConfig.listProviders();
  const dshDefault = await ctx.dshConfig.defaultModelSelection();
  await reply(
    ctx,
    [
      '**dsh 已配置 providers**',
      '',
      ...formatProviders(providers).split('\n'),
      '',
      `dsh 默认模型：${dshDefault ? `\`${dshDefault.model}\`（provider \`${dshDefault.provider}\`）` : '(未设置)'}`,
      '',
      '管理：`/provider add|update|remove`、`/model add|remove`、`/key set|remove`（需管理员）',
    ].join('\n'),
    [
      '**Configured dsh providers**',
      '',
      ...providers.flatMap((provider) => [
        `- **${provider.id}** (${provider.displayName}) — ${provider.configured ? 'configured' : 'not configured'} · ${provider.credentialReady ? 'credential ready' : provider.credentialRef === undefined ? 'credential not configured' : 'credential missing'}`,
        `  models: ${provider.models.length > 0 ? provider.models.map((model) => model.id).join(', ') : '(none)'}`,
      ]),
      '',
      `dsh default model: ${dshDefault ? `\`${dshDefault.model}\` (provider \`${dshDefault.provider}\`)` : '(not set)'}`,
      '',
      'Manage: `/provider add|update|remove`, `/model add|remove`, `/key set|remove` (admin required)',
    ].join('\n'),
  );
}

export async function handleProvider(args: string, ctx: CommandContext): Promise<void> {
  const { positionals, flags, repeated } = parseArgs(args);
  const [sub, id] = positionals;

  if ((sub === 'add' || sub === 'update') && id) {
    if (!requireAdmin(ctx)) return;
    const deepseekFlags = ['base-url', 'api-key-env', 'api-key'];
    const piAiFlags = [
      'display-name',
      'api-key-env',
      'api',
      'base-url',
      'model',
    ];
    const provided = new Set([...Object.keys(flags), ...Object.keys(repeated)]);

    if (id === DEEPSEEK_PROVIDER) {
      const unsupported = [...provided].filter((name) => !deepseekFlags.includes(name));
      if (unsupported.length > 0) {
        await reply(ctx, `\`deepseek-official\` 仅支持 ${deepseekFlags.map((name) => `--${name}`).join(' / ')}，不支持的参数：${unsupported.map((name) => `--${name}`).join('、')}`, `\`deepseek-official\` only supports ${deepseekFlags.map((name) => `--${name}`).join(' / ')}. Unsupported: ${unsupported.map((name) => `--${name}`).join(', ')}`);
        return;
      }
      if (provided.size === 0) {
        await reply(ctx, '用法：`/provider add|update deepseek-official --base-url <url> [--api-key-env <ref>] [--api-key <key>]`', 'Usage: `/provider add|update deepseek-official --base-url <url> [--api-key-env <ref>] [--api-key <key>]`');
        return;
      }
      await ctx.dshConfig.upsertDeepseekProvider({
        ...(flags['base-url'] ? { baseURL: flags['base-url'] } : {}),
        ...(flags['api-key-env'] ? { apiKeyEnv: flags['api-key-env'] } : {}),
        ...(flags['api-key'] ? { apiKey: flags['api-key'] } : {}),
      });
      await reply(
        ctx,
        `已${sub === 'add' ? '添加/更新' : '更新'} provider：\`${id}\`。凭据${flags['api-key'] ? '已写入 .credentials.yaml（值已隐藏）' : '不变'}；其他字段按参数更新。`,
        `${sub === 'add' ? 'Added/updated' : 'Updated'} provider \`${id}\`. The credential ${flags['api-key'] ? 'was written to .credentials.yaml (value hidden)' : 'is unchanged'}; other fields follow the supplied flags.`,
      );
      return;
    }

    const unsupported = [...provided].filter((name) => !piAiFlags.includes(name));
    if (unsupported.length > 0) {
      await reply(ctx, `不支持的参数：${unsupported.map((name) => `--${name}`).join('、')}。可用：${piAiFlags.map((name) => `--${name}`).join(' / ')}`, `Unsupported flags: ${unsupported.map((name) => `--${name}`).join(', ')}. Available: ${piAiFlags.map((name) => `--${name}`).join(' / ')}`);
      return;
    }
    if (provided.size === 0) {
      await reply(ctx, '用法：`/provider add|update <id> --api <protocol> --base-url <url> --model <modelId> [--display-name <name>] [--api-key-env <ref>]`', 'Usage: `/provider add|update <id> --api <protocol> --base-url <url> --model <modelId> [--display-name <name>] [--api-key-env <ref>]`');
      return;
    }
    const models = (repeated.model ?? []).map((modelId) => ({
      id: modelId,
      name: undefined,
      contextWindow: undefined,
      maxTokens: undefined,
    }));
    try {
      await ctx.dshConfig.upsertPiAiProvider({
        id,
        ...(flags['display-name'] ? { displayName: flags['display-name'] } : {}),
        ...(flags['api-key-env'] ? { apiKeyEnv: flags['api-key-env'] } : {}),
        ...(flags.api ? { api: flags.api } : {}),
        ...(flags['base-url'] ? { baseURL: flags['base-url'] } : {}),
        ...(models.length > 0 ? { models } : {}),
      });
      const protocolNote = flags.api ? `协议 \`${flags.api}\`` : '协议不变';
      const modelNote = models.length > 0 ? `，models 已${sub === 'add' ? '写入' : '替换为'} ${models.length} 个` : '';
      const credentialNote = flags['api-key-env']
        ? `凭据引用已设为 \`${flags['api-key-env']}\`，可用 \`/key set ${flags['api-key-env']} <值>\` 写入密钥值。`
        : '`/key set` 的引用名不会自动关联 provider；未设 `--api-key-env` 时密钥不会生效，可先 `/provider update <id> --api-key-env <引用名>` 关联，再 `/key set <引用名> <值>`。';
      await reply(
        ctx,
        [
          `已${sub === 'add' ? '添加' : '更新'} provider：\`${id}\`（${protocolNote}${modelNote}）。`,
          '',
          credentialNote,
          '',
          '密钥不会显示在聊天中。',
          `协议可选：${SUPPORTED_PI_AI_PROTOCOLS.join(' / ')}`,
        ].join('\n'),
        [
          `${sub === 'add' ? 'Added' : 'Updated'} provider \`${id}\`${models.length > 0 ? ` with ${models.length} model(s)` : ''}.`,
          '',
          flags['api-key-env']
            ? `Credential reference set to \`${flags['api-key-env']}\`; use \`/key set ${flags['api-key-env']} <value>\` to store the value.`
            : '`/key set` references are not linked automatically. Set `--api-key-env` on the provider before storing that reference.',
          '',
          'Secrets are never shown in chat.',
          `Protocols: ${SUPPORTED_PI_AI_PROTOCOLS.join(' / ')}`,
        ].join('\n'),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await reply(ctx, `操作失败：${message}`, `Operation failed: ${message}`);
    }
    return;
  }

  if (sub === 'remove' && id) {
    if (!requireAdmin(ctx)) return;
    if (id === DEEPSEEK_PROVIDER) {
      await ctx.dshConfig.removeDeepseekProvider();
      await reply(
        ctx,
        `已删除 provider：\`${id}\`（含 settings 中 llm-deepseek 段及对应凭据）。此操作会移除 dsh 官方 DeepSeek 配置，请谨慎。`,
        `Removed provider \`${id}\`, including the llm-deepseek settings and matching credential. This removes the official dsh DeepSeek configuration.`,
      );
      return;
    }
    const removed = await ctx.dshConfig.removePiAiProvider(id);
    await reply(ctx, removed ? `已删除 provider：\`${id}\`（settings.yaml 已更新）。` : `未找到 provider：\`${id}\`。`, removed ? `Removed provider \`${id}\`; settings.yaml was updated.` : `Provider not found: \`${id}\`.`);
    return;
  }

  await reply(
    ctx,
    [
      '用法：',
      '- `/provider add <id> --api <protocol> --base-url <url> --model <modelId> [--model <modelId> ...] [--display-name <name>] [--api-key-env <ref>]`',
      '- `/provider update <id> [--api <protocol>] [--base-url <url>] [--model <modelId> ...] [--display-name <name>] [--api-key-env <ref>]`',
      '- `/provider remove <id>`',
      '',
      `\`deepseek-official\` 仅支持 --base-url / --api-key-env / --api-key；其他 id 走 llm-pi-ai 自定义 provider（协议可选：${SUPPORTED_PI_AI_PROTOCOLS.join(' / ')}）。`,
    ].join('\n'),
    [
      'Usage:',
      '- `/provider add <id> --api <protocol> --base-url <url> --model <modelId> [--model <modelId> ...] [--display-name <name>] [--api-key-env <ref>]`',
      '- `/provider update <id> [--api <protocol>] [--base-url <url>] [--model <modelId> ...] [--display-name <name>] [--api-key-env <ref>]`',
      '- `/provider remove <id>`',
      '',
      `\`deepseek-official\` only supports --base-url / --api-key-env / --api-key. Other IDs use llm-pi-ai (protocols: ${SUPPORTED_PI_AI_PROTOCOLS.join(' / ')}).`,
    ].join('\n'),
  );
}

export async function handleKey(args: string, ctx: CommandContext): Promise<void> {
  const { positionals } = parseArgs(args);
  const [sub, ...rest] = positionals;

  if (!sub || sub === 'list') {
    const refs = await ctx.dshConfig.listCredentialRefs();
    await reply(
      ctx,
      [
        '**dsh 凭据**（仅显示引用名，不显示值）：',
        ...(refs.length > 0 ? refs.map((ref) => `- \`${ref}\``) : ['（.credentials.yaml 暂无条目）']),
        '',
        '提示：环境变量中的凭据不会显示在这里；provider 的 apiKeyEnv 可引用任意环境变量。',
      ].join('\n'),
      [
        '**dsh credentials** (reference names only; values are hidden):',
        ...(refs.length > 0 ? refs.map((ref) => `- \`${ref}\``) : ['(.credentials.yaml has no entries)']),
        '',
        'Credentials supplied through environment variables are not listed here; a provider apiKeyEnv may reference any environment variable.',
      ].join('\n'),
    );
    return;
  }

  if (!requireAdmin(ctx)) return;

  if (sub === 'set') {
    const ref = rest[0];
    const value = rest.slice(1).join(' ').trim();
    if (!ref || !value) {
      await reply(ctx, '用法：`/key set <引用名> <值>`', 'Usage: `/key set <reference> <value>`');
      return;
    }
    try {
      await ctx.dshConfig.setCredential(ref, value);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await reply(ctx, `写入失败：${message}`, `Write failed: ${message}`);
      return;
    }
    // The user's intuitive flow is `/key set <providerId> <value>`; if the
    // ref matches a pi-ai provider that has no apiKeyEnv yet, link it so the
    // credential actually authenticates that provider's requests.
    const providers = await ctx.dshConfig.listProviders();
    const target = providers.find(
      (provider) =>
        provider.id === ref &&
        provider.namespace === PIAI_NAMESPACE &&
        provider.credentialRef === undefined,
    );
    let autoLinked = false;
    if (target) {
      await ctx.dshConfig.upsertPiAiProvider({ id: ref, apiKeyEnv: ref });
      autoLinked = true;
    }
    await reply(
      ctx,
      [
        `已写入凭据 \`${ref}\` 到 \`~/.dsh/.credentials.yaml\`（0600，值已隐藏）。建议在私聊中使用；群聊里粘贴的密钥会对群成员可见。`,
        ...(autoLinked
          ? [
              '',
              `🔗 已自动把 provider \`${ref}\` 的 apiKeyEnv 关联到 \`${ref}\`（下一请求生效）。`,
            ]
          : []),
      ].join('\n'),
      [
        `Stored credential \`${ref}\` in \`~/.dsh/.credentials.yaml\` (0600; value hidden). Prefer a direct chat because secrets pasted into a group are visible to group members.`,
        ...(autoLinked ? ['', `🔗 Linked provider \`${ref}\` apiKeyEnv to \`${ref}\`; it takes effect on the next request.`] : []),
      ].join('\n'),
    );
    return;
  }

  if (sub === 'remove') {
    const ref = rest[0];
    if (!ref) {
      await reply(ctx, '用法：`/key remove <引用名>`', 'Usage: `/key remove <reference>`');
      return;
    }
    const removed = await ctx.dshConfig.removeCredential(ref);
    await reply(ctx, removed ? `已删除凭据 \`${ref}\`。` : `未找到凭据 \`${ref}\`。`, removed ? `Removed credential \`${ref}\`.` : `Credential not found: \`${ref}\`.`);
    return;
  }

  await reply(ctx, '用法：`/key set <引用名> <值>`、`/key remove <引用名>`、`/key list`', 'Usage: `/key set <reference> <value>`, `/key remove <reference>`, or `/key list`');
}
