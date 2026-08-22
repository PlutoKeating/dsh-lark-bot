/**
 * Single source of truth for the DeepSeek Harness compatibility matrix.
 *
 * The bridge pins exact pre-release versions so a release is reproducible.
 * When upstream publishes a stable version, bump every field here, update
 * `package.json` (exact version), run `pnpm ci:local` plus the compatibility
 * probe, then refresh `verifiedAt`. See `docs/COMPATIBILITY.md`.
 */
export interface DshCompatibility {
  /** DeepSeek Harness CLI (`dsh`) version verified against this bot release. */
  harness: string;
  /** `@deepseek-ai/dsh-sdk-client` version the bridge is pinned to. */
  sdkClient: string;
  /** `@deepseek-ai/dsh-sdk-jsonrpc-server` version installed into SDK runtime profiles. */
  sdkServer: string;
  /** `@deepseek-ai/dsh-acp` version installed into ACP runtime profiles. */
  acp: string;
  /** Node.js engine requirement. */
  node: string;
  /** ISO date of the last end-to-end verification. */
  verifiedAt: string;
}

export const DSH_COMPATIBILITY: DshCompatibility = {
  harness: '0.1.0-rc.8',
  sdkClient: '0.1.0-rc.8',
  sdkServer: '0.1.0-rc.8',
  acp: '0.1.0-rc.8',
  node: '>=22.19.0',
  verifiedAt: '2026-08-22',
};
