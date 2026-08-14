import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { resolveDshRuntime } from './dsh-runtime.js';

export type LarkTenant = 'feishu' | 'lark';
export type AdapterMode = 'sdk' | 'acp' | 'headless';

export interface RuntimeEnv {
  home: string;
  tenant: LarkTenant;
  appId: string | undefined;
  appSecret: string | undefined;
  workspace: string | undefined;
  dshCommand: string;
  dshArgs: string[];
  /** True when DSH_LARK_DSH_COMMAND / DSH_LARK_DSH_ARGS were set explicitly. */
  dshExplicit: boolean;
  adapterMode: AdapterMode;
  provider: string;
  model: string;
  maxTokens: number | undefined;
  runTimeoutMs: number;
  stopGraceMs: number;
  /** Max agent runs allowed concurrently per scope (default 2). */
  scopeConcurrency: number;
  /** Live messages kept per scope before overflow is archived (default 40). */
  retentionMsgs: number;
  /** Max archives retained per scope before pruning (default 50, 0 disables). */
  archiveMax: number;
  /** Archives older than this many days are pruned (default 90, 0 disables). */
  archiveMaxAgeDays: number;
  accessDefaultDeny: boolean;
  eventFreshnessMs: number;
  /** Bridge engine heartbeat interval (guardian liveness signal), default 5000. */
  heartbeatMs: number;
  /** Guardian disabled switch (DSH_LARK_GUARDIAN_DISABLED=1 keeps it stopped). */
  guardianDisabled: boolean;
  /** dsh profile the guardian watches / relaunches (default `dsh-lark`). */
  guardianProfile: string;
  /** Bridge state profile providing Feishu credentials (default `default`). */
  guardianBridgeProfile: string;
  /** Guardian watchdog poll interval, default 2000. */
  guardianPollMs: number;
  /** Heartbeat staleness threshold before takeover, default 15000. */
  guardianStaleMs: number;
  /**
   * When a dsh process is alive but the bridge heartbeat has been stale for
   * longer than this, treat the engine as dead and take over (default 120000).
   */
  guardianEngineDeadMs: number;
}

const DEFAULTS = {
  tenant: 'feishu' as const,
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
  runTimeoutMs: 300_000,
  stopGraceMs: 5_000,
  scopeConcurrency: 2,
  retentionMsgs: 40,
  archiveMax: 50,
  archiveMaxAgeDays: 90,
  heartbeatMs: 5_000,
  guardianPollMs: 2_000,
  guardianStaleMs: 15_000,
  guardianEngineDeadMs: 120_000,
  guardianProfile: 'dsh-lark',
  guardianBridgeProfile: 'default',
};

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseTenant(value: string | undefined): LarkTenant {
  const tenant = nonEmpty(value) ?? DEFAULTS.tenant;
  if (tenant !== 'feishu' && tenant !== 'lark') {
    throw new Error(`DSH_LARK_TENANT must be "feishu" or "lark", got "${tenant}"`);
  }
  return tenant;
}

function parseDshArgs(value: string | undefined): string[] {
  const raw = value?.trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseTimeout(value: string | undefined): number {
  const raw = value?.trim();
  if (!raw) return DEFAULTS.runTimeoutMs;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`DSH_LARK_RUN_TIMEOUT_MS must be a non-negative integer, got "${raw}"`);
  }
  return parsed;
}

function parseStopGrace(value: string | undefined): number {
  const raw = value?.trim();
  if (!raw) return DEFAULTS.stopGraceMs;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`DSH_LARK_STOP_GRACE_MS must be a non-negative integer, got "${raw}"`);
  }
  return parsed;
}

function parseAdapterMode(value: string | undefined): AdapterMode {
  const mode = nonEmpty(value) ?? 'sdk';
  if (mode !== 'sdk' && mode !== 'acp' && mode !== 'headless') {
    throw new Error(`DSH_LARK_ADAPTER must be "sdk", "acp" or "headless", got "${mode}"`);
  }
  return mode;
}

function parseMaxTokens(value: string | undefined): number | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`DSH_LARK_MAX_TOKENS must be a positive integer, got "${raw}"`);
  }
  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const raw = value?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === '1' || raw === 'true' || raw === 'yes') return true;
  if (raw === '0' || raw === 'false' || raw === 'no') return false;
  return fallback;
}

function parseFreshness(value: string | undefined): number {
  const raw = value?.trim();
  if (!raw) return 600_000;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`DSH_LARK_EVENT_FRESHNESS_MS must be a non-negative integer, got "${raw}"`);
  }
  return parsed;
}

function parsePositiveInt(value: string | undefined, fallback: number, name: string): number {
  const raw = value?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer, got "${raw}"`);
  }
  return parsed;
}

function parseMinOneInt(value: string | undefined, fallback: number, name: string): number {
  const raw = value?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer, got "${raw}"`);
  }
  return parsed;
}

function parsePositiveIntMin(value: string | undefined, fallback: number, name: string): number {
  const raw = value?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer, got "${raw}"`);
  }
  return parsed;
}

export function loadRuntimeEnv(
  source: NodeJS.ProcessEnv = process.env,
): RuntimeEnv {
  const homeOverride = nonEmpty(source.DSH_LARK_HOME);
  const workspace = nonEmpty(source.DSH_LARK_WORKSPACE);
  const home = homeOverride ? resolve(homeOverride) : join(homedir(), '.dsh-lark');
  const osHome = homedir();
  const explicitCommand = nonEmpty(source.DSH_LARK_DSH_COMMAND);
  const rawDshArgs = nonEmpty(source.DSH_LARK_DSH_ARGS);
  const dshExplicit = explicitCommand !== undefined || rawDshArgs !== undefined;
  const dshRuntime = resolveDshRuntime({
    home: osHome,
    env: source,
    ...(explicitCommand ? { command: explicitCommand } : {}),
    ...(rawDshArgs ? { args: parseDshArgs(rawDshArgs) } : {}),
  });

  return {
    home,
    tenant: parseTenant(source.DSH_LARK_TENANT),
    appId: nonEmpty(source.DSH_LARK_APP_ID),
    appSecret: nonEmpty(source.DSH_LARK_APP_SECRET),
    workspace: workspace ? resolve(workspace) : undefined,
    dshCommand: dshRuntime.command,
    dshArgs: dshRuntime.args,
    dshExplicit,
    adapterMode: parseAdapterMode(source.DSH_LARK_ADAPTER),
    provider: nonEmpty(source.DSH_LARK_PROVIDER) ?? DEFAULTS.provider,
    model: nonEmpty(source.DSH_LARK_MODEL) ?? DEFAULTS.model,
    maxTokens: parseMaxTokens(source.DSH_LARK_MAX_TOKENS),
    runTimeoutMs: parseTimeout(source.DSH_LARK_RUN_TIMEOUT_MS),
    stopGraceMs: parseStopGrace(source.DSH_LARK_STOP_GRACE_MS),
    scopeConcurrency: parseMinOneInt(
      source.DSH_LARK_SCOPE_CONCURRENCY,
      DEFAULTS.scopeConcurrency,
      'DSH_LARK_SCOPE_CONCURRENCY',
    ),
    retentionMsgs: parsePositiveInt(
      source.DSH_LARK_RETENTION_MSGS,
      DEFAULTS.retentionMsgs,
      'DSH_LARK_RETENTION_MSGS',
    ),
    archiveMax: parsePositiveInt(
      source.DSH_LARK_ARCHIVE_MAX,
      DEFAULTS.archiveMax,
      'DSH_LARK_ARCHIVE_MAX',
    ),
    archiveMaxAgeDays: parsePositiveInt(
      source.DSH_LARK_ARCHIVE_MAX_AGE_DAYS,
      DEFAULTS.archiveMaxAgeDays,
      'DSH_LARK_ARCHIVE_MAX_AGE_DAYS',
    ),
    accessDefaultDeny: parseBoolean(source.DSH_LARK_ACCESS_DEFAULT_DENY, false),
    eventFreshnessMs: parseFreshness(source.DSH_LARK_EVENT_FRESHNESS_MS),
    heartbeatMs: parsePositiveIntMin(
      source.DSH_LARK_HEARTBEAT_MS,
      DEFAULTS.heartbeatMs,
      'DSH_LARK_HEARTBEAT_MS',
    ),
    guardianDisabled: parseBoolean(source.DSH_LARK_GUARDIAN_DISABLED, false),
    guardianProfile:
      nonEmpty(source.DSH_LARK_GUARDIAN_PROFILE) ?? DEFAULTS.guardianProfile,
    guardianBridgeProfile:
      nonEmpty(source.DSH_LARK_GUARDIAN_BRIDGE_PROFILE) ?? DEFAULTS.guardianBridgeProfile,
    guardianPollMs: parsePositiveIntMin(
      source.DSH_LARK_GUARDIAN_POLL_MS,
      DEFAULTS.guardianPollMs,
      'DSH_LARK_GUARDIAN_POLL_MS',
    ),
    guardianStaleMs: parsePositiveIntMin(
      source.DSH_LARK_GUARDIAN_STALE_MS,
      DEFAULTS.guardianStaleMs,
      'DSH_LARK_GUARDIAN_STALE_MS',
    ),
    guardianEngineDeadMs: parsePositiveIntMin(
      source.DSH_LARK_GUARDIAN_ENGINE_DEAD_MS,
      DEFAULTS.guardianEngineDeadMs,
      'DSH_LARK_GUARDIAN_ENGINE_DEAD_MS',
    ),
  };
}
