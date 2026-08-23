import type { Context } from '@deepseek-ai/cordis';
import {
  objectArgs,
  requiredString,
  type RawToolExecution,
  type ToolPluginContext,
} from './raw-tool.js';
import {
  isHighRiskTool,
  planGateDenial,
  policyDenialText,
  type PlanPolicyExecution,
} from '../policy/tool-policy.js';

export { isHighRiskTool, type PlanPolicyExecution } from '../policy/tool-policy.js';

export const name = 'lark-plan-approval';
export const inject = ['tools'];

export interface Config {
  endpoint?: string;
  token?: string;
  mode?: 'strict' | 'off';
}

type PlanGateMode = NonNullable<Config['mode']>;

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
  const approvedCalls = new WeakMap<object, number>();
  const gateDisabled = planGateMode(config.mode ?? process.env.DSH_LARK_PLAN_GATE) === 'off';

  policyCtx.on('agent/pre-step', async (payload, next) => {
    currentTurns.set(payload.agent, payload.turn);
    return next();
  });
  policyCtx.on('tools/pre-execute', async (execution, next) => {
    if (gateDisabled) return next();
    if (!isHighRiskTool(policyCtx, execution)) return next();
    const agent = execution.agent;
    const turn = agent ? currentTurns.get(agent) : undefined;
    if (agent && turn !== undefined && approvedCalls.get(agent) === turn) {
      approvedCalls.delete(agent);
      return next();
    }
    return {
      kind: 'deny',
      reason: policyDenialText(planGateDenial()),
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
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token, sessionId, plan }),
          ...(exec?.signal === undefined ? {} : { signal: exec.signal }),
        });
      } catch (error) {
        if (exec?.signal?.aborted) return { resolved: false, error: 'cancelled' };
        throw error;
      }
      const body = await response.json() as {
        ok?: boolean;
        decision?: 'approved' | 'revise';
        feedback?: string;
        error?: string;
      };
      if (!response.ok || body.ok !== true || !body.decision) {
        if (body.error?.toLowerCase().includes('cancel')) {
          return { resolved: false, error: body.error };
        }
        throw new Error(body.error ?? `plan approval delivery failed (${response.status})`);
      }
      if (body.decision === 'approved' && exec?.agent) {
        const turn = currentTurns.get(exec.agent);
        if (turn !== undefined) approvedCalls.set(exec.agent, turn);
      }
      return {
        resolved: true,
        decision: body.decision,
        ...(body.feedback ? { feedback: body.feedback } : {}),
      };
    },
  });
}

function planGateMode(value: unknown): PlanGateMode {
  return value === 'off' ? 'off' : 'strict';
}
