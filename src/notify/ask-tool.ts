import type { Context } from '@deepseek-ai/cordis';
import {
  objectArgs,
  optionalString,
  optionalStringArray,
  requiredString,
  type RawToolExecution,
  type ToolPluginContext,
} from './raw-tool.js';

/** Cordis plugin name; referenced by the runtime patch row. */
export const name = 'lark-ask';

/** Requires the dsh tool registry before registering. */
export const inject = ['tools'];

export interface Config {
  /** Localhost callback URL of the running bridge process (/ask). */
  endpoint?: string;
  /** Shared token authorizing the callback. */
  token?: string;
}

/** The user may take a while to answer a card; keep the tool well above the
 *  default run-timeout so the question itself is not what kills the task. */
export const ASK_TOOL_TIMEOUT_MS = 600_000;

/**
 * dsh tool that asks the user a question through a Feishu/Lark card when the
 * agent needs a decision, confirmation, or missing information before
 * proceeding. The bridge runs a localhost-only callback server; this plugin
 * is the runtime side of that channel: it posts the question and blocks until
 * the human answers the card.
 */
export function apply(ctx: Context, config: Config = {}) {
  (ctx as ToolPluginContext).tools.register({
      name: 'lark_ask_user',
      description:
        'Ask the user a question through a Feishu/Lark card when you need a decision, confirmation, or missing information before proceeding. The tool blocks until the user answers. Use it sparingly and only for choices or facts only the user can provide; resolve everything discoverable by inspection yourself first.',
      timeoutMs: ASK_TOOL_TIMEOUT_MS,
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['question'],
        properties: {
          question: { type: 'string', minLength: 1, description: 'The question to ask the user.' },
          kind: {
            type: 'string',
            enum: ['single', 'multi', 'text'],
            description:
              'single = one choice, multi = multiple choices, text = free text. Defaults to single when options are given, otherwise text.',
          },
          options: {
            type: 'array',
            items: { type: 'string' },
            description: 'Choices for single / multi questions.',
          },
          header: { type: 'string', description: 'Optional short heading shown above the question.' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['answered'],
          properties: {
            answered: { type: 'boolean' },
            answer: {
              oneOf: [
                { type: 'string' },
                { type: 'array', items: { type: 'string' } },
                { type: 'null' },
              ],
            },
            error: { type: 'string' },
          },
        },
        render: (_args, rawValue) => {
          const value = rawValue as { answered: boolean; answer?: unknown; error?: string };
          return [
            {
              type: 'text',
              text: value.answered
                ? `User answered: ${JSON.stringify(value.answer)}`
                : `Question failed: ${value.error ?? 'no answer'}`,
            },
          ];
        },
      },
      async execute(rawArgs, exec: RawToolExecution | undefined) {
        const args = objectArgs(rawArgs, 'lark_ask_user');
        const question = requiredString(args, 'question', 'lark_ask_user');
        const kindValue = optionalString(args, 'kind', 'lark_ask_user');
        if (kindValue !== undefined && !['single', 'multi', 'text'].includes(kindValue)) {
          throw new Error('lark_ask_user.kind must be single, multi, or text');
        }
        const options = optionalStringArray(args, 'options', 'lark_ask_user');
        const header = optionalString(args, 'header', 'lark_ask_user');
        // The callback endpoint/token may be configured by the patch row or
        // injected at runtime: the bridge process sets the env vars when its
        // notify server starts, so read them lazily at execute time.
        const endpoint = config.endpoint ?? process.env.DSH_LARK_ASK_URL;
        const token = config.token ?? process.env.DSH_LARK_NOTIFY_TOKEN;
        if (!endpoint || !token) {
          throw new Error('lark_ask_user is not configured (endpoint/token missing)');
        }
        const sessionId =
          exec?.agent?.session === undefined
            ? undefined
            : String(exec.agent.session.id);
        if (!sessionId) {
          throw new Error('lark_ask_user needs an active session to route the question');
        }
        const kind =
          kindValue ?? (options && options.length > 0 ? 'single' : 'text');
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            token,
            sessionId,
            question,
            kind,
            ...(options && options.length > 0 ? { options } : {}),
            ...(header === undefined ? {} : { header }),
          }),
          ...(exec?.signal === undefined ? {} : { signal: exec.signal }),
        });
        const body = (await response.json()) as {
          ok?: boolean;
          answer?: string | string[] | null;
          error?: string;
        };
        if (!response.ok || body.ok !== true) {
          return {
            answered: false,
            ...(body.error === undefined ? {} : { error: body.error }),
          };
        }
        return {
          answered: true,
          ...(body.answer === undefined ? {} : { answer: body.answer ?? null }),
        };
      },
    });
}
