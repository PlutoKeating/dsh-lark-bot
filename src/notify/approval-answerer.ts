import type { Context } from '@deepseek-ai/cordis';
import {
  isHighRiskTool,
  policyDenialText,
  toolApprovalDenial,
  type PlanPolicyExecution,
  type PolicyDenial,
} from '../policy/tool-policy.js';
import type { ToolPluginContext } from './raw-tool.js';

export const name = 'lark-approval-answerer';
export const inject = ['approval', 'tools'];

export interface Config {
  endpoint?: string;
  token?: string;
}

type Outcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable';

interface ApprovalDecision {
  outcome: Outcome;
  denial?: PolicyDenial;
}

interface RawApprovalRequest {
  agent?: { session?: { id?: unknown } };
  toolName?: unknown;
  callId?: unknown;
  reason?: unknown;
  toolInput?: unknown;
  signal?: AbortSignal;
}

type ApprovalContext = Context & {
  on(
    event: 'approval/request',
    listener: (request: RawApprovalRequest, next: () => Promise<Outcome>) => Promise<Outcome>,
  ): unknown;
  on(
    event: 'tools/pre-execute',
    listener: (
      execution: PlanPolicyExecution,
      next: () => Promise<unknown>,
    ) => Promise<unknown>,
  ): unknown;
};

/** Terminal rc.8 approval answerer for the nested SDK and host runtimes. */
export function apply(ctx: Context, config: Config = {}): void {
  const approvalCtx = ctx as ApprovalContext & ToolPluginContext;
  const inFlightGrant = new WeakMap<object, string>();

  approvalCtx.on('approval/request', async (request, next) => {
    if (request.agent && inFlightGrant.get(request.agent) === request.toolName) {
      inFlightGrant.delete(request.agent);
      return 'allowed-once';
    }
    return (await requestBridgeApproval(config, request, next)).outcome;
  });

  approvalCtx.on('tools/pre-execute', async (execution, next) => {
    if (!isHighRiskTool(approvalCtx, execution)) return next();
    const request: RawApprovalRequest = {
      ...(execution.agent === undefined
        ? {}
        : { agent: execution.agent as NonNullable<RawApprovalRequest['agent']> }),
      toolName: execution.name,
      reason: approvalReason(execution),
      toolInput: execution.arguments,
    };
    const decision = await requestBridgeApproval(config, request, async () => 'unavailable');
    if (decision.outcome !== 'allowed-once') {
      return {
        kind: 'deny',
        reason: policyDenialText(
          decision.denial ?? (
            decision.outcome === 'rejected'
              ? toolApprovalDenial(execution.name)
              : {
                  layer: 'tool-approval',
                  reason: `tool ${execution.name} did not receive approval (${decision.outcome})`,
                  toChange: 'retry only after approval is available, or choose a safer alternative',
                }
          ),
        ),
      };
    }
    if (execution.agent) inFlightGrant.set(execution.agent, execution.name);
    try {
      return await next();
    } finally {
      if (execution.agent) inFlightGrant.delete(execution.agent);
    }
  });
}

async function requestBridgeApproval(
  config: Config,
  request: RawApprovalRequest,
  next: () => Promise<Outcome>,
): Promise<ApprovalDecision> {
    const endpoint = config.endpoint ?? process.env.DSH_LARK_APPROVAL_URL;
    const token = config.token ?? process.env.DSH_LARK_NOTIFY_TOKEN;
    if (!endpoint || !token) return { outcome: await next() };
    const sessionId = request.agent?.session?.id;
    if (sessionId === undefined || typeof request.toolName !== 'string') {
      return { outcome: 'unavailable' };
    }
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token,
          sessionId: String(sessionId),
          toolName: request.toolName,
          ...(request.callId === undefined ? {} : { callId: String(request.callId) }),
          ...(typeof request.reason === 'string' ? { reason: request.reason } : {}),
          ...(request.toolInput === undefined ? {} : { toolInput: request.toolInput }),
        }),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      });
      const body = await response.json() as {
        ok?: boolean;
        outcome?: unknown;
        denial?: unknown;
      };
      return response.ok && body.ok === true && isOutcome(body.outcome)
        ? {
            outcome: body.outcome,
            ...(isPolicyDenial(body.denial) ? { denial: body.denial } : {}),
          }
        : { outcome: 'unavailable' };
    } catch {
      return { outcome: request.signal?.aborted ? 'cancelled' : 'unavailable' };
    }
}

function approvalReason(execution: PlanPolicyExecution): string {
  if (
    typeof execution.arguments === 'object' && execution.arguments !== null &&
    'description' in execution.arguments &&
    typeof (execution.arguments as { description?: unknown }).description === 'string'
  ) {
    return (execution.arguments as { description: string }).description;
  }
  return `Execute high-risk tool ${execution.name}`;
}

function isOutcome(value: unknown): value is Outcome {
  return value === 'allowed-once' || value === 'rejected' ||
    value === 'cancelled' || value === 'unavailable';
}

function isPolicyDenial(value: unknown): value is PolicyDenial {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const denial = value as Partial<PolicyDenial>;
  return (
    denial.layer === 'plan-gate' || denial.layer === 'permission-policy' ||
    denial.layer === 'tool-approval' || denial.layer === 'file-sandbox'
  ) && typeof denial.reason === 'string' && typeof denial.toChange === 'string';
}
