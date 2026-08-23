export interface UpstreamConfig {
  id: string;
  name: string;
  repository: string;
  trackFrom: string;
  tagPrefix?: string;
  npmPackages: string[];
}

export interface UpstreamSourceData {
  githubReleases: Array<Record<string, unknown>>;
  npmDocuments: Record<string, Record<string, unknown>>;
  sourceErrors: string[];
}

export interface ReleaseEvent {
  version: string;
  githubRelease?: Record<string, unknown>;
  npmPackages: Array<{ name: string; publishedAt?: string; distTags: Record<string, string> }>;
  sourceErrors: string[];
}

export function normalizeVersion(input: string): string | undefined;
export function compareVersions(a: string, b: string): number;
export function collectReleaseEvents(
  upstream: UpstreamConfig,
  data: UpstreamSourceData,
): ReleaseEvent[];
export function sanitizeExternalMarkdown(input: string, limit?: number): string;
export function buildIssueBody(upstream: UpstreamConfig, event: ReleaseEvent): string;
export function extractReleaseMarker(
  body: string,
): { upstream: string; version: string } | undefined;
export function indexReleaseIssues(
  issues: Array<Record<string, unknown>>,
): Map<string, Record<string, unknown>>;
export function replaceManagedSection(body: string, managed: string): string;
export function fetchUpstreamData(
  upstream: UpstreamConfig,
  fetchImpl?: typeof fetch,
): Promise<UpstreamSourceData>;
