import type { Context } from '@deepseek-ai/cordis';
import {
  objectArgs,
  optionalString,
  requiredString,
  type RawToolExecution,
  type ToolPluginContext,
} from './raw-tool.js';

export const name = 'lark-file';
export const inject = ['tools'];

export interface Config {
  endpoint?: string;
  token?: string;
}

export function apply(ctx: Context, config: Config = {}) {
  (ctx as ToolPluginContext).tools.register({
    name: 'lark_send_file',
    description: 'Upload a local result file from the current workspace to the current Feishu/Lark chat. Use for reports, patches, images, archives, and logs. The bridge rejects missing, oversized, non-regular, or out-of-scope files.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: {
        path: { type: 'string', minLength: 1, description: 'Absolute path or path relative to the current runtime working directory.' },
        file_name: { type: 'string', description: 'Optional plain download filename.' },
      },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false, required: ['ok'],
        properties: { ok: { type: 'boolean' }, fileName: { type: 'string' }, size: { type: 'number' }, error: { type: 'string' } },
      },
      render: (_args, rawValue) => {
        const value = rawValue as { ok: boolean; fileName?: string; size?: number; error?: string };
        return [{ type: 'text', text: value.ok
          ? `File sent: ${value.fileName ?? 'file'} (${String(value.size ?? 0)} bytes)`
          : `File failed: ${value.error ?? 'unknown error'}` }];
      },
    },
    async execute(rawArgs, exec: RawToolExecution | undefined) {
      const args = objectArgs(rawArgs, 'lark_send_file');
      const path = requiredString(args, 'path', 'lark_send_file');
      const fileName = optionalString(args, 'file_name', 'lark_send_file');
      const endpoint = config.endpoint ?? process.env.DSH_LARK_FILE_URL;
      const token = config.token ?? process.env.DSH_LARK_NOTIFY_TOKEN;
      if (!endpoint || !token) throw new Error('lark_send_file is not configured (endpoint/token missing)');
      const sessionId = exec?.agent?.session === undefined ? undefined : String(exec.agent.session.id);
      if (!sessionId) throw new Error('lark_send_file needs an active session');
      const agent = exec?.agent as { cwd?: unknown } | undefined;
      const runtimeCwd = typeof agent?.cwd === 'string' ? agent.cwd : process.cwd();
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, sessionId, path, runtimeCwd, ...(fileName ? { fileName } : {}) }),
        ...(exec?.signal === undefined ? {} : { signal: exec.signal }),
      });
      const body = await response.json() as { ok?: boolean; fileName?: string; size?: number; error?: string };
      return {
        ok: response.ok && body.ok === true,
        ...(body.fileName === undefined ? {} : { fileName: body.fileName }),
        ...(body.size === undefined ? {} : { size: body.size }),
        ...(body.error === undefined ? {} : { error: body.error }),
      };
    },
  });
}
