export interface CompatApprovalRequest {
  sessionId?: unknown;
  toolName?: unknown;
  policyCheckOnly?: unknown;
  lowRisk?: unknown;
  toolInput?: unknown;
}

export interface CompatApprovalRoute {
  kind: 'policy-check' | 'low-risk' | 'approval';
  response: {
    ok: true;
    policy?: 'ask';
    outcome?: 'allowed-once' | 'rejected';
  };
}

export function resolveCompatApprovalRequest(
  request: CompatApprovalRequest,
): CompatApprovalRoute;
