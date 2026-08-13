import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { resolveDshRuntime } from './dsh-runtime.js';

export type LarkTenant = 'feishu' | 'lark';

export interface RuntimeEnv {
  home: string;
  tenant: LarkTenant;
  appId: string | undefined;
  appSecret: string | undefined;
  workspace: string | undefined;
  dshCommand: string;
  dshArgs: string[];
  provider: string;
  model: string;
  runTimeoutMs: number;
  stopGraceMs: number;
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

export function loadRuntimeEnv(
  source: NodeJS.ProcessEnv = process.env,
): RuntimeEnv {
  const homeOverride = nonEmpty(source.DSH_LARK_HOME);
  const workspace = nonEmpty(source.DSH_LARK_WORKSPACE);
  const home = homeOverride ? resolve(homeOverride) : join(homedir(), '.dsh-lark');
  const osHome = homedir();
  const dshCommand = nonEmpty(source.DSH_LARK_DSH_COMMAND);
  const rawDshArgs = nonEmpty(source.DSH_LARK_DSH_ARGS);
  const dshRuntime = resolveDshRuntime({
    home: osHome,
    env: source,
    ...(dshCommand ? { command: dshCommand } : {}),
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
    provider: nonEmpty(source.DSH_LARK_PROVIDER) ?? DEFAULTS.provider,
    model: nonEmpty(source.DSH_LARK_MODEL) ?? DEFAULTS.model,
    runTimeoutMs: parseTimeout(source.DSH_LARK_RUN_TIMEOUT_MS),
    stopGraceMs: parseStopGrace(source.DSH_LARK_STOP_GRACE_MS),
  };
}
