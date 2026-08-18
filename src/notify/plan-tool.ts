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

interface PlanPolicyExecution {
  name: string;
  arguments: unknown;
  agent?: object;
}

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

function isHighRiskTool(ctx: ToolPluginContext, execution: PlanPolicyExecution): boolean {
  if (execution.name === 'lark_request_plan_approval') return false;
  if (execution.name === 'run_code') return true;
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
  const normalized = execution.name.toLowerCase().replaceAll('-', '_');
  return /(^|_)(bash|shell|exec|execute|run|write|edit|patch|delete|remove|move|rename)(_|$)/u
    .test(normalized);
}
