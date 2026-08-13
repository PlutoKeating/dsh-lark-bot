import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

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
}

const DEFAULTS = {
  tenant: 'feishu' as const,
  dshCommand: 'node',
  dshArgs: ['lib/bin.js', 'cordis.yml'],
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
  runTimeoutMs: 300_000,
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
  if (!raw) return [...DEFAULTS.dshArgs];
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

export function loadRuntimeEnv(
  source: NodeJS.ProcessEnv = process.env,
): RuntimeEnv {
  const homeOverride = nonEmpty(source.DSH_LARK_HOME);
  const workspace = nonEmpty(source.DSH_LARK_WORKSPACE);

  return {
    home: homeOverride ? resolve(homeOverride) : join(homedir(), '.dsh-lark'),
    tenant: parseTenant(source.DSH_LARK_TENANT),
    appId: nonEmpty(source.DSH_LARK_APP_ID),
    appSecret: nonEmpty(source.DSH_LARK_APP_SECRET),
    workspace: workspace ? resolve(workspace) : undefined,
    dshCommand: nonEmpty(source.DSH_LARK_DSH_COMMAND) ?? DEFAULTS.dshCommand,
    dshArgs: parseDshArgs(source.DSH_LARK_DSH_ARGS),
    provider: nonEmpty(source.DSH_LARK_PROVIDER) ?? DEFAULTS.provider,
    model: nonEmpty(source.DSH_LARK_MODEL) ?? DEFAULTS.model,
    runTimeoutMs: parseTimeout(source.DSH_LARK_RUN_TIMEOUT_MS),
  };
}
