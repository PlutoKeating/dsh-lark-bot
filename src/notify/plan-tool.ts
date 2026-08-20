import type { Context } from '@deepseek-ai/cordis';
import {
  objectArgs,
  requiredString,
  type RawToolExecution,
  type ToolPluginContext,
} from './raw-tool.js';

export const name = 'lark-plan-approval';
export const inject = ['tools'];

export interface Config {
  endpoint?: string;
  token?: string;
}

export interface PlanPolicyExecution {
  name: string;
  arguments: unknown;
  agent?: object;
}

const READ_ONLY_SHELL_TOOLS = new Set(['bash', 'shell']);
const READ_ONLY_COMMANDS = new Set([
  'basename',
  'cat',
  'date',
  'df',
  'dirname',
  'du',
  'grep',
  'head',
  'id',
  'jq',
  'ls',
  'pgrep',
  'ps',
  'pwd',
  'readlink',
  'realpath',
  'rg',
  'stat',
  'tail',
  'uname',
  'wc',
  'whoami',
]);
const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  'diff',
  'ls-files',
  'ls-tree',
  'log',
  'merge-base',
  'rev-parse',
  'show',
  'status',
]);
const SHELL_CONTROL_SYNTAX = /[\n\r;&|<>`]|\$\(|\$\{/u;

type PlanPolicyContext = ToolPluginContext & {
  on(
    event: 'agent/pre-step',
    listener: (
      payload: { agent: object; turn: number },
      next: () => Promise<unknown>,
    ) => Promise<unknown>,
  ): unknown;
  on(
    event: 'tools/pre-execute',
    listener: (
      execution: PlanPolicyExecution,
      next: () => Promise<unknown>,
    ) => Promise<unknown>,
  ): unknown;
};

/** Human plan gate for substantial or high-risk repository actions. */
export function apply(ctx: Context, config: Config = {}) {
  const policyCtx = ctx as PlanPolicyContext;
  const currentTurns = new WeakMap<object, number>();
  const approvedTurns = new WeakMap<object, number>();

  policyCtx.on('agent/pre-step', async (payload, next) => {
    currentTurns.set(payload.agent, payload.turn);
    return next();
  });
  policyCtx.on('tools/pre-execute', async (execution, next) => {
    if (!isHighRiskTool(policyCtx, execution)) return next();
    const agent = execution.agent;
    const turn = agent ? currentTurns.get(agent) : undefined;
    if (agent && turn !== undefined && approvedTurns.get(agent) === turn) return next();
    return {
      kind: 'deny',
      reason:
        'This action is blocked until the current turn calls lark_request_plan_approval and the user approves the plan.',
    };
  });

  policyCtx.tools.register({
    name: 'lark_request_plan_approval',
    description:
      'Before modifying files, running scripts, or taking another substantial/high-risk action, draft a complete plan and call this tool before execution. It sends the full plan as a normal Feishu/Lark message, then waits for Approve or Continue planning plus optional feedback. Do not execute until approved. If revision is requested, revise the plan and call this tool again.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['plan'],
      properties: {
        plan: { type: 'string', minLength: 1, description: 'Complete readable plan in Markdown.' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['resolved'],
        properties: {
          resolved: { type: 'boolean' },
          decision: { type: 'string', enum: ['approved', 'revise'] },
          feedback: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render: (_args, rawValue) => {
        const value = rawValue as {
          resolved: boolean;
          decision?: string;
          feedback?: string;
          error?: string;
        };
        return [{
          type: 'text',
          text: value.resolved
            ? `Plan decision: ${value.decision}${value.feedback ? `; feedback: ${value.feedback}` : ''}`
            : `Plan approval failed: ${value.error ?? 'cancelled'}`,
        }];
      },
    },
    async execute(rawArgs, exec: RawToolExecution | undefined) {
      const args = objectArgs(rawArgs, 'lark_request_plan_approval');
      const plan = requiredString(args, 'plan', 'lark_request_plan_approval');
      const endpoint = config.endpoint ?? process.env.DSH_LARK_PLAN_URL;
      const token = config.token ?? process.env.DSH_LARK_NOTIFY_TOKEN;
      if (!endpoint || !token) {
        throw new Error('lark_request_plan_approval is not configured (endpoint/token missing)');
      }
      const sessionId = exec?.agent?.session === undefined
        ? undefined
        : String(exec.agent.session.id);
      if (!sessionId) throw new Error('lark_request_plan_approval needs an active session');
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, sessionId, plan }),
        ...(exec?.signal === undefined ? {} : { signal: exec.signal }),
      });
      const body = await response.json() as {
        ok?: boolean;
        decision?: 'approved' | 'revise';
        feedback?: string;
        error?: string;
      };
      if (!response.ok || body.ok !== true || !body.decision) {
        return { resolved: false, ...(body.error ? { error: body.error } : {}) };
      }
      if (body.decision === 'approved' && exec?.agent) {
        const turn = currentTurns.get(exec.agent);
        if (turn !== undefined) approvedTurns.set(exec.agent, turn);
      }
      return {
        resolved: true,
        decision: body.decision,
        ...(body.feedback ? { feedback: body.feedback } : {}),
      };
    },
  });
}

export function isHighRiskTool(ctx: ToolPluginContext, execution: PlanPolicyExecution): boolean {
  if (execution.name === 'lark_request_plan_approval') return false;
  if (execution.name === 'run_code') return true;
  const normalized = execution.name.toLowerCase().replaceAll('-', '_');
  if (READ_ONLY_SHELL_TOOLS.has(normalized)) {
    return !isSimpleReadOnlyShellCommand(execution.arguments);
  }
  try {
    const view = ctx.tools.get?.(execution.name, execution.agent)?.presentCall?.(
      execution.arguments,
    ) as { card?: string; kind?: string } | undefined;
    if (view?.card === 'terminal' || view?.card === 'diff') return true;
    const kind = view?.kind;
    if (kind && ['edit', 'delete', 'move', 'execute'].includes(kind)) return true;
  } catch {
    // Fall through to the conservative name classifier.
  }
  return /(^|_)(bash|shell|exec|execute|run|write|edit|patch|delete|remove|move|rename)(_|$)/u
    .test(normalized);
}

/**
 * Read-only shell calls bypass both the plan gate and one-shot approval.
 * Keep this deliberately narrow: one command only, no shell composition, and
 * an allowlisted executable/subcommand. Unknown syntax remains high risk.
 */
function isSimpleReadOnlyShellCommand(rawArguments: unknown): boolean {
  const command = shellCommand(rawArguments)?.trim();
  if (!command || SHELL_CONTROL_SYNTAX.test(command)) return false;
  const words = command.split(/\s+/u);
  const executablePath = words[0];
  if (
    !executablePath ||
    (executablePath.includes('/') &&
      !executablePath.startsWith('/bin/') &&
      !executablePath.startsWith('/usr/bin/'))
  ) return false;
  const executable = executablePath.split('/').at(-1);
  if (!executable) return false;
  if (executable === 'git') return isReadOnlyGitCommand(words.slice(1));
  if (!READ_ONLY_COMMANDS.has(executable)) return false;
  if (executable === 'date') {
    return words.slice(1).every((word) =>
      word === '-u' || word === '--utc' || word === '--universal' || word.startsWith('+')
    );
  }
  if (executable === 'rg') {
    return !words.slice(1).some((word) =>
      word === '--pre' ||
      word.startsWith('--pre=') ||
      word === '--hostname-bin' ||
      word.startsWith('--hostname-bin=')
    );
  }
  return true;
}

function shellCommand(rawArguments: unknown): string | undefined {
  if (typeof rawArguments === 'object' && rawArguments !== null && !Array.isArray(rawArguments)) {
    const command = (rawArguments as { command?: unknown }).command;
    return typeof command === 'string' ? command : undefined;
  }
  if (typeof rawArguments !== 'string') return undefined;
  try {
    return shellCommand(JSON.parse(rawArguments));
  } catch {
    return rawArguments;
  }
}

function isReadOnlyGitCommand(words: readonly string[]): boolean {
  let index = 0;
  while (words[index] === '-C') {
    if (!words[index + 1]) return false;
    index += 2;
  }
  const subcommand = words[index];
  if (subcommand === 'branch') {
    const flags = words.slice(index + 1);
    return flags.length === 0 || flags.every((word) =>
      ['--show-current', '--list', '--all', '-a', '--remotes', '-r', '-v', '-vv'].includes(word)
    );
  }
  if (subcommand === 'remote') {
    const args = words.slice(index + 1);
    return args.length === 0 ||
      args.every((word) => word === '-v' || word === '--verbose') ||
      args[0] === 'get-url';
  }
  if (!subcommand || !READ_ONLY_GIT_SUBCOMMANDS.has(subcommand)) return false;
  return !words.slice(index + 1).some((word) =>
    word === '-o' ||
    word === '--output' ||
    word.startsWith('--output=') ||
    word === '--ext-diff' ||
    word === '--textconv'
  );
}
