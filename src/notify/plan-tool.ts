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
  type PolicyDenial,
} from '../policy/tool-policy.js';

export { isHighRiskTool, type PlanPolicyExecution } from '../policy/tool-policy.js';

export const name = 'lark-plan-approval';
export const inject = ['tools'];

export interface Config {
  endpoint?: string;
  policyEndpoint?: string;
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
    const policyDecision = await checkPermissionPolicy(config, execution);
    if (policyDecision?.denial) {
      return { kind: 'deny', reason: policyDenialText(policyDecision.denial) };
    }
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

async function checkPermissionPolicy(
  config: Config,
  execution: PlanPolicyExecution,
): Promise<{ policy: 'ask' | 'allow' | 'deny'; denial?: PolicyDenial } | undefined> {
  const endpoint = config.policyEndpoint ?? process.env.DSH_LARK_APPROVAL_URL;
  const token = config.token ?? process.env.DSH_LARK_NOTIFY_TOKEN;
  const sessionId = (execution.agent as { session?: { id?: unknown } } | undefined)?.session?.id;
  if (!endpoint || !token || sessionId === undefined) return undefined;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token,
        sessionId: String(sessionId),
        toolName: execution.name,
        policyCheckOnly: true,
      }),
    });
    const body = await response.json() as { ok?: boolean; policy?: unknown; denial?: unknown };
    if (!response.ok || body.ok !== true || !isPermissionPolicy(body.policy)) {
      return { policy: 'deny', denial: unavailablePolicyDenial(execution.name) };
    }
    return {
      policy: body.policy,
      ...(isPolicyDenial(body.denial) ? { denial: body.denial } : {}),
    };
  } catch {
    return { policy: 'deny', denial: unavailablePolicyDenial(execution.name) };
  }
}

function unavailablePolicyDenial(toolName: string): PolicyDenial {
  return {
    layer: 'permission-policy',
    reason: `the bridge could not verify the scope policy before tool ${toolName}`,
    toChange: 'restore the local bridge approval callback before retrying the tool',
  };
}

function isPermissionPolicy(value: unknown): value is 'ask' | 'allow' | 'deny' {
  return value === 'ask' || value === 'allow' || value === 'deny';
}

function isPolicyDenial(value: unknown): value is PolicyDenial {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const denial = value as Partial<PolicyDenial>;
  return (
    denial.layer === 'plan-gate' || denial.layer === 'permission-policy' ||
    denial.layer === 'tool-approval' || denial.layer === 'file-sandbox'
  ) && typeof denial.reason === 'string' && typeof denial.toChange === 'string';
}

function planGateMode(value: unknown): PlanGateMode {
  return value === 'off' ? 'off' : 'strict';
}
