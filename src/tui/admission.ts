export type TuiAdmissionState =
  | 'compatible'
  | 'compatible_degraded'
  | 'waiting_authorization'
  | 'rejected'
  | 'unknown';

export interface AdmissionContract {
  apiVersion: string;
  kind: string;
  optional?: boolean;
  fallback?: string;
}

export interface AdmissionManifest {
  manifestVersion: string;
  facets: { host: { apiVersion: string } };
  requires: { contracts: AdmissionContract[] };
  permissions: Array<{ name: string; scope: string }>;
}

export interface AdmissionHostDescriptor {
  $schema: string;
  facetApiVersions: string[];
  contracts: Array<{
    apiVersion: string;
    kind: string;
    permissions: string[];
  }>;
  runtime: {
    location: 'local' | 'remote' | 'container';
    generationId: string;
    headless: boolean;
    remoteAttach?: boolean;
  };
  trustLevel: string;
}

export interface AdmissionDecision {
  state: TuiAdmissionState;
  reasons: string[];
}

const PRIORITY: Record<TuiAdmissionState, number> = {
  compatible: 0,
  compatible_degraded: 1,
  waiting_authorization: 2,
  rejected: 3,
  unknown: 4,
};

/**
 * Pure five-state projection for the pinned TUI Admission v0.15 policy.
 * It is diagnostic only: the TUI host remains the authority that admits and
 * authorizes a concrete activation generation.
 */
export function negotiateTuiAdmission(input: {
  manifest: AdmissionManifest;
  host: AdmissionHostDescriptor;
  knownContracts: Array<{ apiVersion: string; kind: string }>;
  grantedPermissions?: string[];
}): AdmissionDecision {
  const findings: Array<{ state: TuiAdmissionState; reason: string }> = [];
  if (input.manifest.manifestVersion !== '0.15') {
    findings.push({ state: 'rejected', reason: 'manifestVersion is not 0.15' });
  }
  if (input.host.$schema !== 'urn:dsh-tui:host-descriptor:0.15') {
    findings.push({ state: 'unknown', reason: 'host descriptor schema is not the pinned v0.15 schema' });
  }
  if (input.host.trustLevel !== 'trusted-in-process') {
    findings.push({ state: 'rejected', reason: 'unsupported host trust level' });
  }
  if (!input.host.facetApiVersions.includes(input.manifest.facets.host.apiVersion)) {
    findings.push({ state: 'rejected', reason: 'host facet API version is unavailable' });
  }
  if (!input.host.runtime.generationId) {
    findings.push({ state: 'rejected', reason: 'runtime generation identity is missing' });
  }

  const known = new Set(input.knownContracts.map(contractKey));
  const supported = new Map(input.host.contracts.map((contract) => [contractKey(contract), contract]));
  for (const requirement of input.manifest.requires.contracts) {
    const key = contractKey(requirement);
    if (!known.has(key)) {
      findings.push({ state: 'unknown', reason: `contract is outside the pinned registry: ${key}` });
      continue;
    }
    if (!supported.has(key)) {
      findings.push({
        state: requirement.optional ? 'compatible_degraded' : 'rejected',
        reason: requirement.optional
          ? `optional contract unavailable; fallback: ${requirement.fallback ?? 'unspecified'}`
          : `required contract unavailable: ${key}`,
      });
    }
  }

  const granted = new Set(input.grantedPermissions ?? []);
  for (const permission of input.manifest.permissions) {
    if (!granted.has(permission.name)) {
      findings.push({ state: 'waiting_authorization', reason: `permission is not granted: ${permission.name}` });
    }
  }
  const highest = findings.reduce<TuiAdmissionState>(
    (state, finding) => PRIORITY[finding.state] > PRIORITY[state] ? finding.state : state,
    'compatible',
  );
  return {
    state: highest,
    reasons: findings.filter((finding) => finding.state === highest).map((finding) => finding.reason),
  };
}

function contractKey(value: { apiVersion: string; kind: string }): string {
  return `${value.apiVersion} ${value.kind}`;
}
