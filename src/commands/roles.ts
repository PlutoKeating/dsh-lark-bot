import type { RoleStore } from '../bot/role-store.js';
import type { CommandContext } from './index.js';

interface ParsedRoleArgs {
  positionals: string[];
  flags: Record<string, string | undefined>;
}

/**
 * Parse `/role save <id> <name> --flag value...` where long flags consume
 * everything up to the next flag, so multi-word persona/rules text works.
 */
function parseRoleArgs(input: string): ParsedRoleArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | undefined> = {};
  let rest = input.trim();
  while (rest) {
    const flagMatch = rest.match(/^--([a-z-]+)\s*/);
    if (!flagMatch) {
      const token = rest.split(/\s+/, 1)[0] ?? '';
      positionals.push(token);
      rest = rest.slice(token.length).trim();
      continue;
    }
    const flag = flagMatch[1] ?? '';
    rest = rest.slice(flagMatch[0].length);
    const nextFlag = rest.search(/\s--[a-z-]+(?:\s|$)/);
    if (nextFlag === -1) {
      flags[flag] = rest.trim();
      rest = '';
    } else {
      flags[flag] = rest.slice(0, nextFlag).trim();
      rest = rest.slice(nextFlag).trim();
    }
  }
  return { positionals, flags };
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

function describeRole(role: NonNullable<ReturnType<RoleStore['get']>>): string {
  const lines = [
    `**${role.name}** (\`${role.id}\`)`,
    '',
    role.persona,
  ];
  if (role.model) lines.push('', `- model: \`${role.model}\``);
  if (role.tools) lines.push(`- tools: \`${role.tools}\``);
  if (role.agentsMd) lines.push('', '**rules (AGENTS.md):**', '', role.agentsMd);
  return lines.join('\n');
}

/** `/role list` — list roles and the current scope binding. */
async function handleRoleList(ctx: CommandContext): Promise<void> {
  const roles = ctx.roleStore.list();
  const current = ctx.roleStore.roleForScope(ctx.scope);
  if (roles.length === 0) {
    await reply(ctx, '还没有定义角色。管理员可用 `/role save <id> <name> --persona <text>` 创建。');
    return;
  }
  const lines = roles.map((role) => {
    const marker = role.id === current?.id ? ' ← 当前 scope' : '';
    return `- \`${role.id}\` — **${role.name}**${marker}`;
  });
  await reply(ctx, ['**角色列表**', '', ...lines].join('\n'));
}

/** `/role show <id>` — show role details. */
async function handleRoleShow(args: string, ctx: CommandContext): Promise<void> {
  const id = args.trim();
  const role = ctx.roleStore.get(id);
  if (!role) {
    await reply(ctx, `未找到角色：\`${id}\``);
    return;
  }
  await reply(ctx, describeRole(role));
}

/** `/role set <id>` / `/role clear` — bind or unbind the current scope. */
async function handleRoleSet(args: string, ctx: CommandContext): Promise<void> {
  const id = args.trim();
  if (!ctx.roleStore.setScopeRole(ctx.scope, id)) {
    await reply(ctx, `未找到角色：\`${id}\`，请先 \`/role save\` 创建。`);
    return;
  }
  await reply(ctx, `当前 scope 已绑定角色：\`${id}\`。下一轮消息生效。`);
}

async function handleRoleClear(_args: string, ctx: CommandContext): Promise<void> {
  const cleared = ctx.roleStore.clearScopeRole(ctx.scope);
  await reply(ctx, cleared ? '已解除当前 scope 的角色绑定。' : '当前 scope 未绑定角色。');
}

/** `/role save <id> <name> [--persona ..] [--model ..] [--tools ..] [--rules ..]` — admin. */
async function handleRoleSave(args: string, ctx: CommandContext): Promise<void> {
  if (!requireAdmin(ctx)) return;
  const { positionals, flags } = parseRoleArgs(args);
  const [id, name] = positionals;
  if (!id || !name) {
    await reply(
      ctx,
      '用法：`/role save <id> <name> [--persona <text>] [--model <id>] [--tools <csv>] [--rules <text>]`',
    );
    return;
  }
  const existing = ctx.roleStore.get(id);
  const persona = flags.persona ?? existing?.persona;
  if (!persona) {
    await reply(ctx, '`--persona` 必填（或更新已有角色时省略以保留原 persona）。');
    return;
  }
  const model = flags.model ?? existing?.model;
  const tools = flags.tools ?? existing?.tools;
  const agentsMd = flags.rules ?? existing?.agentsMd;
  ctx.roleStore.upsert({
    id,
    name,
    persona,
    ...(model === undefined ? {} : { model }),
    ...(tools === undefined ? {} : { tools }),
    ...(agentsMd === undefined ? {} : { agentsMd }),
  });
  await reply(ctx, `角色已保存：\`${id}\`（${name}）。`);
}

/** `/role remove <id>` — admin. */
async function handleRoleRemove(args: string, ctx: CommandContext): Promise<void> {
  if (!requireAdmin(ctx)) return;
  const id = args.trim();
  const removed = ctx.roleStore.remove(id);
  await reply(ctx, removed ? `已删除角色：\`${id}\`（相关 scope 绑定一并清除）。` : `未找到角色：\`${id}\``);
}

export async function handleRole(args: string, ctx: CommandContext): Promise<void> {
  const [sub, ...rest] = args.trim().split(/\s+/);
  switch (sub) {
    case 'list':
    case undefined:
    case '':
      await handleRoleList(ctx);
      return;
    case 'show':
      await handleRoleShow(rest.join(' ').trim(), ctx);
      return;
    case 'set':
      await handleRoleSet(rest.join(' ').trim(), ctx);
      return;
    case 'clear':
      await handleRoleClear('', ctx);
      return;
    case 'save':
      await handleRoleSave(rest.join(' ').trim(), ctx);
      return;
    case 'remove':
      await handleRoleRemove(rest.join(' ').trim(), ctx);
      return;
    default:
      await reply(ctx, '未知 `/role` 子命令，请使用 list / show / set / clear / save / remove。');
  }
}
