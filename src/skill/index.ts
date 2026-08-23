import type { Context } from '@deepseek-ai/cordis';
import { registerDshLarkBotSkill } from './dsh-lark-bot.js';

/** Cordis plugin name; referenced by the runtime patch row. */
export const name = 'lark-skill';

/** Requires the dsh skill registry before registering. */
export const inject = ['skills'];

export interface Config {
  /** Reserved for future per-session skill configuration. */
  enabled?: boolean;
}

/**
 * dsh skill that exposes the dsh-lark-bot channel operations guide to the
 * agent session's model-invocable skill catalog — the one the `skill` tool
 * reads (`ctx.skills.list({ scope: agent })`).
 *
 * The bridge engine registers the same skill on its own cordis context (see
 * `plugin.ts`), but that context is never what the model reads. This plugin
 * registers it on the agent runtime's context, so `skill("dsh-lark-bot")`
 * resolves in a live SDK session.
 *
 * This entry is intentionally dependency-free (only the `skills` service) so
 * it can also load in the guardian's core-only safe profile.
 */
export function apply(ctx: Context) {
  const registry = (
    ctx as unknown as {
      skills?: Parameters<typeof registerDshLarkBotSkill>[0];
    }
  ).skills;
  if (!registry) return;
  const disposeSkill = registerDshLarkBotSkill(registry);
  ctx.effect(() => disposeSkill);
}
