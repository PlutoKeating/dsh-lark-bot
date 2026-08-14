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
  accessDefaultDeny: boolean;
  eventFreshnessMs: number;
}

const DEFAULTS = {
  tenant: 'feishu' as const,
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
  runTimeoutMs: 300_000,
  stopGraceMs: 5_000,
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
    accessDefaultDeny: parseBoolean(source.DSH_LARK_ACCESS_DEFAULT_DENY, false),
    eventFreshnessMs: parseFreshness(source.DSH_LARK_EVENT_FRESHNESS_MS),
  };
}
