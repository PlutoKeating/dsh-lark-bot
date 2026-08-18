import type { Context } from '@deepseek-ai/cordis';
import {
  objectArgs,
  optionalString,
  optionalStringArray,
  requiredString,
  type ToolPluginContext,
} from './raw-tool.js';

/** Cordis plugin name; referenced by the runtime patch row. */
export const name = 'lark-notify';

/** Requires the dsh tool registry before registering. */
export const inject = ['tools'];

export interface Config {
  /** Localhost callback URL of the running bridge process. */
  endpoint?: string;
  /** Shared token authorizing the callback. */
  token?: string;
}

/**
 * dsh tool that lets the agent push Feishu/Lark messages (optionally with
 * user mentions) to the current chat or another scope known to the bridge.
 * The bridge runs a localhost-only callback server; this plugin is the
 * runtime side of that channel.
 */
export function apply(ctx: Context, config: Config = {}) {
  (ctx as ToolPluginContext).tools.register({
      name: 'lark_notify',
      description:
        'Send a Feishu/Lark message to the current chat or to another chat/topic scope known to the dsh-lark-bot bridge. Use this when a task finishes and another session, group or member should be notified.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['text'],
        properties: {
          text: { type: 'string', minLength: 1, description: 'The message text to send.' },
          scope: {
            type: 'string',
            description:
              'Target scope key: a chat id (e.g. oc_...) or a topic scope "chatId:threadId". Omit to send to the current chat.',
          },
          chat_id: { type: 'string', description: 'Direct chat id fallback when scope is unknown.' },
          mention_user_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Feishu/Lark open_ids (ou_...) of users to @mention.',
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['ok'],
          properties: {
            ok: { type: 'boolean' },
            chatId: { type: 'string' },
            error: { type: 'string' },
          },
        },
        render: (_args, rawValue) => {
          const value = rawValue as { ok: boolean; chatId?: string; error?: string };
          return [
            {
              type: 'text',
              text: value.ok
                ? `Message sent to ${value.chatId ?? 'chat'}`
                : `Message failed: ${value.error ?? 'unknown error'}`,
            },
          ];
        },
      },
      async execute(rawArgs) {
        const args = objectArgs(rawArgs, 'lark_notify');
        const text = requiredString(args, 'text', 'lark_notify');
        const scope = optionalString(args, 'scope', 'lark_notify');
        const chatId = optionalString(args, 'chat_id', 'lark_notify');
        const mentionUserIds = optionalStringArray(args, 'mention_user_ids', 'lark_notify');
        // The callback endpoint/token may be configured by the patch row or
        // injected at runtime: the bridge process sets the env vars when its
        // notify server starts, so read them lazily at execute time.
        const endpoint = config.endpoint ?? process.env.DSH_LARK_NOTIFY_URL;
        const token = config.token ?? process.env.DSH_LARK_NOTIFY_TOKEN;
        if (!endpoint || !token) {
          throw new Error('lark_notify is not configured (endpoint/token missing)');
        }
        const payload: Record<string, unknown> = {
          token,
          text,
        };
        if (scope) payload.scope = scope;
        if (chatId) payload.chatId = chatId;
        if (mentionUserIds && mentionUserIds.length > 0) {
          payload.mentions = mentionUserIds.map((userId) => ({ userId }));
        }
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const body = (await response.json()) as { ok?: boolean; chatId?: string; error?: string };
        return {
          ok: response.ok && body.ok === true,
          ...(body.chatId === undefined ? {} : { chatId: body.chatId }),
          ...(body.error === undefined ? {} : { error: body.error }),
        };
      },
    });
}
