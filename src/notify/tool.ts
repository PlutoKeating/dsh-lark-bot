import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';

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
  ctx.tools.register(
    defineTool({
      name: 'lark_notify',
      description:
        'Send a Feishu/Lark message to the current chat or to another chat/topic scope known to the dsh-lark-bot bridge. Use this when a task finishes and another session, group or member should be notified.',
      parameters: {
        text: {
          type: 'string',
          required: true,
          description: 'The message text to send.',
        },
        scope: {
          type: 'string',
          description:
            'Target scope key: a chat id (e.g. oc_...) or a topic scope "chatId:threadId". Omit to send to the current chat.',
        },
        chat_id: {
          type: 'string',
          description: 'Direct chat id fallback when scope is unknown.',
        },
        mention_user_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Feishu/Lark open_ids (ou_...) of users to @mention.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            chatId: { type: 'string' },
            error: { type: 'string' },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: value.ok
              ? `Message sent to ${value.chatId ?? 'chat'}`
              : `Message failed: ${value.error ?? 'unknown error'}`,
          },
        ],
      },
      async execute(args) {
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
          text: args.text,
        };
        if (args.scope) payload.scope = args.scope;
        if (args.chat_id) payload.chatId = args.chat_id;
        if (args.mention_user_ids && args.mention_user_ids.length > 0) {
          payload.mentions = args.mention_user_ids.map((userId: string) => ({ userId }));
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
    }),
  );
}
