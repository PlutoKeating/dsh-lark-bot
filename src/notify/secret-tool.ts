import type { Context } from '@deepseek-ai/cordis';
import { objectArgs, optionalString, requiredString, type RawToolExecution, type ToolPluginContext } from './raw-tool.js';

export const name = 'lark-secret';
export const inject = ['tools'];
export interface Config { endpoint?: string; token?: string }

export function apply(ctx: Context, config: Config = {}) {
  (ctx as ToolPluginContext).tools.register({
    name: 'lark_request_secret',
    description: 'Request an administrator to enter a supported secret in an owner-only Feishu/Lark form. Never ask for or accept secret values in chat.',
    parameters: { type: 'object', additionalProperties: false, required: ['target', 'reference'], properties: {
      target: { type: 'string', enum: ['dsh-credential', 'app-secret'] },
      reference: { type: 'string', minLength: 1 }, purpose: { type: 'string', maxLength: 500 },
    } },
    output: { schema: { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' }, target: { type: 'string' }, reference: { type: 'string' }, configured: { type: 'boolean' }, error: { type: 'string' } } },
      render: (_args, raw) => { const value = raw as { ok: boolean; target?: string; reference?: string; error?: string }; return [{ type: 'text', text: value.ok ? `Secret configured: ${value.target}/${value.reference}` : `Secret request failed: ${value.error ?? 'unknown error'}` }]; } },
    async execute(rawArgs, exec: RawToolExecution | undefined) {
      const args = objectArgs(rawArgs, 'lark_request_secret');
      const target = requiredString(args, 'target', 'lark_request_secret');
      if (target !== 'dsh-credential' && target !== 'app-secret') throw new Error('unsupported secret target');
      const reference = requiredString(args, 'reference', 'lark_request_secret');
      const purpose = optionalString(args, 'purpose', 'lark_request_secret');
      const endpoint = config.endpoint ?? process.env.DSH_LARK_SECRET_URL;
      const token = config.token ?? process.env.DSH_LARK_NOTIFY_TOKEN;
      const sessionId = exec?.agent?.session === undefined ? undefined : String(exec.agent.session.id);
      if (!endpoint || !token || !sessionId) throw new Error('lark_request_secret is not configured');
      const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, sessionId, target, reference, ...(purpose ? { purpose } : {}) }), ...(exec?.signal ? { signal: exec.signal } : {}) });
      const body = await response.json() as Record<string, unknown>;
      return { ...body, ok: response.ok && body.ok === true };
    },
  });
}
