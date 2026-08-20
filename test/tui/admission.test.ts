import { describe, expect, it } from 'vitest';
import {
  negotiateTuiAdmission,
  type AdmissionHostDescriptor,
  type AdmissionManifest,
} from '../../src/tui/admission.js';

const manifest: AdmissionManifest = {
  manifestVersion: '0.15',
  facets: { host: { apiVersion: 'v1alpha1' } },
  requires: { contracts: [{
    apiVersion: 'presentation.dsh/v1alpha1', kind: 'UserInteraction', optional: true,
    fallback: 'use Feishu cards',
  }] },
  permissions: [],
};

const host: AdmissionHostDescriptor = {
  $schema: 'urn:dsh-tui:host-descriptor:0.15',
  facetApiVersions: ['v1alpha1'],
  contracts: [{ apiVersion: 'presentation.dsh/v1alpha1', kind: 'UserInteraction', permissions: [] }],
  runtime: { location: 'local', generationId: 'generation-1', headless: false },
  trustLevel: 'trusted-in-process',
};

const knownContracts = [{ apiVersion: 'presentation.dsh/v1alpha1', kind: 'UserInteraction' }];

describe('pinned TUI Admission v0.15 negotiation projection', () => {
  it('returns compatible', () => {
    expect(negotiateTuiAdmission({ manifest, host, knownContracts }).state).toBe('compatible');
  });

  it('returns compatible_degraded for a missing optional contract with fallback', () => {
    expect(negotiateTuiAdmission({ manifest, host: { ...host, contracts: [] }, knownContracts }))
      .toEqual(expect.objectContaining({ state: 'compatible_degraded', reasons: [expect.stringContaining('fallback')] }));
  });

  it('returns waiting_authorization when a declared permission has not been granted', () => {
    expect(negotiateTuiAdmission({
      manifest: { ...manifest, permissions: [{ name: 'commands.invoke', scope: 'plugin.command' }] },
      host, knownContracts, grantedPermissions: [],
    }).state).toBe('waiting_authorization');
  });

  it('returns rejected for an unsupported required facet', () => {
    expect(negotiateTuiAdmission({
      manifest, host: { ...host, facetApiVersions: ['v2alpha1'] }, knownContracts,
    }).state).toBe('rejected');
  });

  it('returns unknown with the mandated highest priority for an unregistered coordinate', () => {
    expect(negotiateTuiAdmission({
      manifest: {
        ...manifest,
        permissions: [{ name: 'commands.invoke', scope: 'plugin.command' }],
        requires: { contracts: [{ apiVersion: 'future.dsh/v1alpha1', kind: 'Future' }] },
      },
      host: { ...host, facetApiVersions: [] },
      knownContracts,
      grantedPermissions: [],
    }).state).toBe('unknown');
  });

  it.each([
    { location: 'local' as const, headless: false, remoteAttach: false },
    { location: 'remote' as const, headless: true, remoteAttach: true },
    { location: 'container' as const, headless: true, remoteAttach: true },
  ])('does not bind compatibility to one Presentation/runtime ($location)', (runtime) => {
    expect(negotiateTuiAdmission({
      manifest,
      host: { ...host, runtime: { ...runtime, generationId: `generation-${runtime.location}` } },
      knownContracts,
    }).state).toBe('compatible');
  });
});
