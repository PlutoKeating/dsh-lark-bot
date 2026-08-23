import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { ApprovalRegistry } from '../src/bot/approvals.js';
import type { PermissionPolicyStore } from '../src/bot/permission-policy-store.js';
import { ScopeDirectory } from '../src/bridge/scope-directory.js';
import { buildApprovalHandler } from '../src/notify/approval-handler.js';
import { SessionStore } from '../src/session/store.js';
import { resolveCompatApprovalRequest } from '../scripts/compat-approval-fixture.mjs';

function productionApprovalHandler() {
  const sessions = new SessionStore(':memory:');
  sessions.set('compat-scope', 'compat-session', '/tmp/compat-workspace');
  const scopeDirectory = new ScopeDirectory(':memory:');
  scopeDirectory.register('compat-scope', 'compat-chat', undefined);
  return buildApprovalHandler({
    sessions,
    scopeDirectory,
    approvals: new ApprovalRegistry(),
    channel: { sendCard: vi.fn() },
    permissionPolicies: { get: () => 'ask' } as unknown as PermissionPolicyStore,
  });
}

describe('dsh compatibility approval fixture', () => {
  it('matches the production policy-preflight and low-risk response contract', async () => {
    const handler = productionApprovalHandler();
    const policyRequest = {
      token: 'compat-token',
      sessionId: 'compat-session',
      toolName: 'lark_request_plan_approval',
      policyCheckOnly: true,
    } as const;
    const lowRiskRequest = {
      token: 'compat-token',
      sessionId: 'compat-session',
      toolName: 'lark_request_plan_approval',
      lowRisk: true,
    } as const;

    const policyRoute = resolveCompatApprovalRequest(policyRequest);
    expect(policyRoute.kind).toBe('policy-check');
    expect(policyRoute.response).toEqual(await handler(policyRequest));

    const lowRiskRoute = resolveCompatApprovalRequest(lowRiskRequest);
    expect(lowRiskRoute.kind).toBe('low-risk');
    expect(lowRiskRoute.response).toEqual(await handler(lowRiskRequest));
  });

  it('keeps real one-shot approvals separate from silent protocol traffic', () => {
    expect(resolveCompatApprovalRequest({
      sessionId: 'compat-session',
      toolName: 'bash',
      toolInput: { command: 'printf must-not-run-approval' },
    })).toEqual({ kind: 'approval', response: { ok: true, outcome: 'rejected' } });
  });
});

describe('release compatibility gate', () => {
  it('runs the real compatibility probe in local and GitHub release gates', async () => {
    const [packageText, workflow] = await Promise.all([
      readFile(new URL('../package.json', import.meta.url), 'utf8'),
      readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'),
    ]);
    const pkg = JSON.parse(packageText) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.['release:check']).toContain('pnpm compat:probe');
    const probeIndex = workflow.indexOf('node scripts/probe-dsh-compat.mjs');
    const publishIndex = workflow.indexOf('Publish both npm packages');
    expect(probeIndex).toBeGreaterThan(-1);
    expect(publishIndex).toBeGreaterThan(probeIndex);
  });
});
