import { renderSkillCommandIndex } from '../commands/catalog.js';

interface SkillRegistration {
  name: string;
  description: string;
  whenToUse?: string;
  content: string;
  source: 'runtime';
  invocation: { modelInvocable: boolean; userInvocable: boolean };
}

const content = `# dsh-lark-bot channel operations

Use this skill when the current channel context says \`channel: dsh-lark-bot\`, or when the user asks you to install, deploy, upgrade, diagnose, or configure this Feishu/Lark channel.

Before any change, read the current effective configuration and installed versions. Never copy example values into settings. Prefer existing dsh-lark-bot commands, dsh's official settings/credentials protocol, and registered channel tools. Re-read status after a change and explain whether it applies on the next request, new session, reconnect, or service restart.

For provider/model/settings work: inspect with \`/config\` (the model/provider/credential card; \`/model\`, \`/provider(s)\`, \`/key\` are aliases of the same card), \`/status\`, or dsh settings first. Support query, add, update, remove, reset-to-default, and verification. Administrator-only writes, plan approval, per-tool approval, permission policy, workspace containment, and file policy remain mandatory.

For any API key, provider credential, token, or App Secret value, never ask the user to paste it into ordinary chat and never invent a file path or configuration key. Call \`lark_request_secret\` with only a supported target type, a validated reference name, and a short purpose. The tool result intentionally contains only configured state—not the value. The value crosses Feishu/Lark's form transport to the local bridge but must never enter the model prompt, transcript, jobs, archive, logs, diagnostic bundle, or response.

Language policy has three distinct layers: Card UI is per-viewer; plain fallback is bilingual/Chinese/English; agent final answers are auto/Chinese/English. Use \`/language\` to inspect it and require an administrator for global changes.

Guardian/safe mode is a degraded recovery surface and cannot claim full channel configuration or secure-secret tooling unless the live context explicitly advertises it.

## Command index (generated from the same registry as /help)

${renderSkillCommandIndex()}

## Operational surfaces

- Installation and lifecycle: \`setup\`, \`upgrade\`, \`doctor\`, \`service install|start|status|logs|restart|stop|uninstall\`, and \`guardian install|status|logs|restart|stop|uninstall\`.
- Configuration: dsh Web settings for common bridge fields; official \`settings.yaml\` for providers/models/default route; owner-only \`.credentials.yaml\` through the secure secret seam for values.
- Sessions/workspaces: /new, /cd, /ws, /session, /resume, /retention, /archive, /timeout, /concurrency, /stop.
- Policy/collaboration: /permission, /isolation, /role, /invite, /notify, /notifications, /replies.
`;

export const DSH_LARK_BOT_SKILL: SkillRegistration = {
  name: 'dsh-lark-bot',
  description: 'Operate and safely self-configure the active dsh-lark-bot Feishu/Lark channel.',
  whenToUse: 'Use for channel identity, setup, upgrade, deployment, diagnostics, provider/model/credential/language configuration, or command discovery.',
  content,
  source: 'runtime',
  invocation: { modelInvocable: true, userInvocable: true },
};

export function registerDshLarkBotSkill(registry: { register(skill: SkillRegistration): () => void }): () => void {
  return registry.register(DSH_LARK_BOT_SKILL);
}
