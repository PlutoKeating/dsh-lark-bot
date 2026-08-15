import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';

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

interface AskToolExec {
  agent?: { session?: { id?: unknown } };
  signal?: AbortSignal;
}

/**
 * dsh tool that asks the user a question through a Feishu/Lark card when the
 * agent needs a decision, confirmation, or missing information before
 * proceeding. The bridge runs a localhost-only callback server; this plugin
 * is the runtime side of that channel: it posts the question and blocks until
 * the human answers the card.
 */
export function apply(ctx: Context, config: Config = {}) {
  ctx.tools.register(
    defineTool({
      name: 'lark_ask_user',
      description:
        'Ask the user a question through a Feishu/Lark card when you need a decision, confirmation, or missing information before proceeding. The tool blocks until the user answers. Use it sparingly and only for choices or facts only the user can provide; resolve everything discoverable by inspection yourself first.',
      timeoutMs: ASK_TOOL_TIMEOUT_MS,
      parameters: {
        question: {
          type: 'string',
          required: true,
          description: 'The question to ask the user.',
        },
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
        header: {
          type: 'string',
          description: 'Optional short heading shown above the question.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            answered: { type: 'boolean', required: true },
            answer: { type: 'json' },
            error: { type: 'string' },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: value.answered
              ? `User answered: ${JSON.stringify(value.answer)}`
              : `Question failed: ${value.error ?? 'no answer'}`,
          },
        ],
      },
      async execute(args, exec: AskToolExec | undefined) {
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
          args.kind ?? (args.options && args.options.length > 0 ? 'single' : 'text');
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            token,
            sessionId,
            question: args.question,
            kind,
            ...(args.options && args.options.length > 0 ? { options: args.options } : {}),
            ...(args.header === undefined ? {} : { header: args.header }),
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
    }),
  );
}
