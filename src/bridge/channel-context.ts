import type { LanguagePolicy } from '../bot/language-policy-store.js';

export interface ChannelContext {
  channel: 'dsh-lark-bot';
  tenant: 'feishu' | 'lark';
  chatType: 'p2p' | 'group' | 'topic';
  scope: string;
  bridgeProfile: string;
  adapter: string;
  tools: string[];
  language: LanguagePolicy;
  secretCollection: 'available' | 'unavailable';
}

/** A bounded, secret-free identity block injected into every fresh/resumed run. */
export function renderChannelContext(context: ChannelContext): string {
  const agentLanguage = context.language.agent === 'zh'
    ? 'Write the final answer in Chinese unless the user explicitly requests another language.'
    : context.language.agent === 'en'
      ? 'Write the final answer in English unless the user explicitly requests another language.'
      : 'Mirror the user’s current language for the final answer unless they explicitly request another language.';
  return [
    '[Channel context — trusted bridge metadata]',
    `channel: ${context.channel}`,
    `tenant: ${context.tenant}`,
    `chat_type: ${context.chatType}`,
    `scope: ${context.scope}`,
    `bridge_profile: ${context.bridgeProfile}`,
    `adapter: ${context.adapter}`,
    `available_channel_tools: ${context.tools.join(', ') || '(none)'}`,
    `language_policy: ui=${context.language.ui}; plain=${context.language.plain}; agent=${context.language.agent}`,
    `secure_value_collection: ${context.secretCollection}`,
    agentLanguage,
    'This turn arrived through the dsh-lark-bot Feishu/Lark channel. Use the dsh-lark-bot skill for channel setup, configuration, and diagnostics. Never ask for a secret in ordinary chat; use lark_request_secret when secure value collection is available.',
    'Slash commands are handled by the bridge before the agent and are separate from model-callable tools: do not infer their absence from available_channel_tools. If the runtime skill cannot be loaded, tell the user to run /help for the authoritative command list.',
  ].join('\n');
}
