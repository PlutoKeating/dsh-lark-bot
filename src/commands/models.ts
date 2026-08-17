import type { DshModelEntry, DshProviderSummary } from '../config/dsh-config.js';
import { DEEPSEEK_PROVIDER, SUPPORTED_PI_AI_PROTOCOLS } from '../config/dsh-config.js';
import type { CommandContext } from './index.js';

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

async function reply(ctx: CommandContext, markdown: string): Promise<void> {
  await ctx.channel.sendMarkdown(ctx.chatId, markdown, {
    replyTo: ctx.messageId,
  });
}

function requireAdmin(ctx: CommandContext): boolean {
  if (!ctx.accessManager.isAdmin(ctx.senderId)) {
    void reply(ctx, '仅管理员可执行该操作。');
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

async function findModelOwner(
  ctx: CommandContext,
  id: string,
): Promise<DshProviderSummary | undefined> {
  const providers = await ctx.dshConfig.listProviders();
  return providers.find((provider) => provider.models.some((model) => model.id === id));
}

function deepseekModelInput(args: {
  id: string;
  flags: Record<string, string | undefined>;
}): DshModelEntry {
  return {
    id: args.id,
    name: args.flags.name,
    contextWindow: undefined,
    maxTokens: undefined,
  };
}

export async function handleModel(args: string, ctx: CommandContext): Promise<void> {
  const { positionals, flags } = parseArgs(args);
  const [sub, ...rest] = positionals;

  if (!sub) {
    const active = ctx.models.get(ctx.scope) ?? ctx.defaultModel;
    const dshDefault = await ctx.dshConfig.defaultModelSelection();
    const providers = await ctx.dshConfig.listProviders();
    const modelLines = providers.flatMap((provider) =>
      provider.models.map((model) => `- ${formatModel(model)} ← ${provider.id}`),
    );
    await reply(
      ctx,
      [
        `**当前会话模型**：\`${active}\``,
        `**dsh 默认模型**（agent-default-model）：${dshDefault ? `\`${dshDefault.model}\`（provider \`${dshDefault.provider}\`）` : '(未设置)'}`,
        `**bot 回退默认**（profile / DSH_LARK_MODEL）：\`${ctx.defaultModel}\``,
        '',
        '**可用模型**（dsh 已配置）：',
        ...(modelLines.length > 0 ? modelLines : ['（暂无）']),
        '',
        '用法：`/model use <id>`、`/model default <id>`、`/model reset`、`/model add|remove <provider> <modelId> [--name <name>]`',
      ].join('\n'),
    );
    return;
  }

  if (sub === 'use') {
    const id = rest.join(' ').trim();
    if (!id) {
      await reply(ctx, '用法：`/model use <modelId>`');
      return;
    }
    const provider = await findModelOwner(ctx, id);
    if (!provider) {
      await reply(ctx, `未找到模型 \`${id}\`，可用 /model 查看列表。`);
      return;
    }
    ctx.models.set(ctx.scope, id);
    await reply(ctx, `已热切换当前会话模型：\`${id}\`（下一轮消息生效，无需重启 bot）。`);
    return;
  }

  if (sub === 'reset') {
    const cleared = ctx.models.clear(ctx.scope);
    await reply(ctx, cleared ? '已清除当前会话模型覆盖，恢复 bot 默认模型。' : '当前会话没有模型覆盖。');
    return;
  }

  if (sub === 'default') {
    const id = rest.join(' ').trim();
    if (!id) {
      await reply(ctx, '用法：`/model default <modelId>`');
      return;
    }
    const provider = await findModelOwner(ctx, id);
    if (!provider) {
      await reply(ctx, `未找到模型 \`${id}\`，可用 /model 查看列表。`);
      return;
    }
    if (!requireAdmin(ctx)) return;
    await ctx.dshConfig.setDefaultModel(id);
    await reply(ctx, `已写入 dsh 默认模型（agent-default-model）：\`${id}\`，新会话生效。`);
    return;
  }

  if (sub === 'add' || sub === 'remove') {
    if (!requireAdmin(ctx)) return;
    const providerId = rest[0];
    const id = rest[1];
    if (!providerId || !id) {
      await reply(ctx, `用法：\`/model ${sub} <provider> <modelId> [--name <name>]\``);
      return;
    }
    if (sub === 'add') {
      if (providerId === DEEPSEEK_PROVIDER) {
        await ctx.dshConfig.addDeepseekModel(deepseekModelInput({ id, flags }));
        await reply(ctx, `已添加模型：\`${providerId}\` → \`${id}\`（settings.yaml 已更新，下一请求生效）。`);
      } else {
        await ctx.dshConfig.addPiAiModel(providerId, deepseekModelInput({ id, flags }));
        await reply(ctx, `已添加模型：\`${providerId}\` → \`${id}\`（settings.yaml 已更新，下一请求生效）。`);
      }
    } else if (providerId === DEEPSEEK_PROVIDER) {
      const removed = await ctx.dshConfig.removeDeepseekModel(id);
      await reply(ctx, removed ? `已删除模型：\`${providerId}\` → \`${id}\`。` : `未找到模型：\`${id}\`。`);
    } else {
      const removed = await ctx.dshConfig.removePiAiModel(providerId, id);
      await reply(ctx, removed ? `已删除模型：\`${providerId}\` → \`${id}\`。` : `未找到模型：\`${id}\`。`);
    }
    return;
  }

  await reply(ctx, '未知 `/model` 子命令，请使用 use / default / reset / add / remove。');
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
        await reply(ctx, `\`deepseek-official\` 仅支持 ${deepseekFlags.map((name) => `--${name}`).join(' / ')}，不支持的参数：${unsupported.map((name) => `--${name}`).join('、')}`);
        return;
      }
      if (provided.size === 0) {
        await reply(ctx, '用法：`/provider add|update deepseek-official --base-url <url> [--api-key-env <ref>] [--api-key <key>]`');
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
      );
      return;
    }

    const unsupported = [...provided].filter((name) => !piAiFlags.includes(name));
    if (unsupported.length > 0) {
      await reply(ctx, `不支持的参数：${unsupported.map((name) => `--${name}`).join('、')}。可用：${piAiFlags.map((name) => `--${name}`).join(' / ')}`);
      return;
    }
    if (provided.size === 0) {
      await reply(ctx, '用法：`/provider add|update <id> --api <protocol> --base-url <url> --model <modelId> [--display-name <name>] [--api-key-env <ref>]`');
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
      );
    } catch (error) {
      await reply(ctx, `操作失败：${error instanceof Error ? error.message : String(error)}`);
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
      );
      return;
    }
    const removed = await ctx.dshConfig.removePiAiProvider(id);
    await reply(ctx, removed ? `已删除 provider：\`${id}\`（settings.yaml 已更新）。` : `未找到 provider：\`${id}\`。`);
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
    );
    return;
  }

  if (!requireAdmin(ctx)) return;

  if (sub === 'set') {
    const ref = rest[0];
    const value = rest.slice(1).join(' ').trim();
    if (!ref || !value) {
      await reply(ctx, '用法：`/key set <引用名> <值>`');
      return;
    }
    try {
      await ctx.dshConfig.setCredential(ref, value);
    } catch (error) {
      await reply(ctx, `写入失败：${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    await reply(
      ctx,
      `已写入凭据 \`${ref}\` 到 \`~/.dsh/.credentials.yaml\`（0600，值已隐藏）。建议在私聊中使用；群聊里粘贴的密钥会对群成员可见。`,
    );
    return;
  }

  if (sub === 'remove') {
    const ref = rest[0];
    if (!ref) {
      await reply(ctx, '用法：`/key remove <引用名>`');
      return;
    }
    const removed = await ctx.dshConfig.removeCredential(ref);
    await reply(ctx, removed ? `已删除凭据 \`${ref}\`。` : `未找到凭据 \`${ref}\`。`);
    return;
  }

  await reply(ctx, '用法：`/key set <引用名> <值>`、`/key remove <引用名>`、`/key list`');
}
