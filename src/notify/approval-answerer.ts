import type { Context } from '@deepseek-ai/cordis';
import { isHighRiskTool, type PlanPolicyExecution } from './plan-tool.js';
import type { ToolPluginContext } from './raw-tool.js';

export const name = 'lark-approval-answerer';
export const inject = ['approval', 'tools'];

export interface Config {
  endpoint?: string;
  token?: string;
}

type Outcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable';

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
    return requestBridgeApproval(config, request, next);
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
    const outcome = await requestBridgeApproval(config, request, async () => 'unavailable');
    if (outcome !== 'allowed-once') {
      return {
        kind: 'deny',
        reason: outcome === 'rejected'
          ? 'The user rejected this one-shot tool execution. Continue with a safer alternative.'
          : 'This tool execution was not approved and remains blocked.',
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
): Promise<Outcome> {
    const endpoint = config.endpoint ?? process.env.DSH_LARK_APPROVAL_URL;
    const token = config.token ?? process.env.DSH_LARK_NOTIFY_TOKEN;
    if (!endpoint || !token) return next();
    const sessionId = request.agent?.session?.id;
    if (sessionId === undefined || typeof request.toolName !== 'string') return 'unavailable';
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
      const body = await response.json() as { ok?: boolean; outcome?: unknown };
      return response.ok && body.ok === true && isOutcome(body.outcome)
        ? body.outcome
        : 'unavailable';
    } catch {
      return request.signal?.aborted ? 'cancelled' : 'unavailable';
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
