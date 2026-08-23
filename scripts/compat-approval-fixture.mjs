/**
 * Classify an approval callback request for the compatibility probe.
 *
 * Keep this small and deterministic: the unit contract test compares these
 * responses with the production approval handler so protocol drift fails in
 * seconds, before the networked dsh probe is needed.
 */
export function resolveCompatApprovalRequest(request) {
  if (request.policyCheckOnly === true) {
    return {
      kind: 'policy-check',
      response: { ok: true, policy: 'ask' },
    };
  }
  if (request.lowRisk === true) {
    return {
      kind: 'low-risk',
      response: { ok: true, outcome: 'allowed-once' },
    };
  }
  return {
    kind: 'approval',
    response: {
      ok: true,
      outcome: request.toolInput?.command === 'printf must-not-run-approval'
        ? 'rejected'
        : 'allowed-once',
    },
  };
}
