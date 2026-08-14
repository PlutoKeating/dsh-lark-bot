import { homedir } from 'node:os';
import type { RuntimeEnv } from '../config/env.js';
import { DshAdapter } from './dsh/adapter.js';
import { SdkDshAdapter } from './dsh/sdk-adapter.js';
import { ensureSdkProfile, resolveSdkLaunch } from './dsh/sdk-runtime.js';
import type { AgentAdapter } from './types.js';

export interface AdapterPreferences {
  stopGraceMs: number | undefined;
  model: string | undefined;
}

/**
 * Build the agent adapter for the configured mode:
 * - `sdk` (default): official `@deepseek-ai/dsh-sdk-client` runtime.
 * - `acp`: official ACP server runtime with approval cards.
 * - `headless`: legacy subprocess fallback (kept for compatibility).
 */
export async function buildAgentAdapter(
  env: RuntimeEnv,
  preferences: AdapterPreferences = { stopGraceMs: undefined, model: undefined },
): Promise<AgentAdapter> {
  switch (env.adapterMode) {
    case 'headless': {
      const options: ConstructorParameters<typeof DshAdapter>[0] = {
        command: env.dshCommand,
        args: env.dshArgs,
      };
      if (preferences.stopGraceMs !== undefined) {
        options.stopGraceMs = preferences.stopGraceMs;
      }
      return new DshAdapter(options);
    }
    case 'acp': {
      const { buildAcpAgentAdapter } = await import('./dsh/acp-adapter.js');
      return buildAcpAgentAdapter(env, preferences);
    }
    case 'sdk':
    default: {
      const runtimeOptions = {
        home: homedir(),
        env: process.env,
        ...(env.dshExplicit
          ? { command: env.dshCommand, args: env.dshArgs }
          : {}),
      };
      const ensure = await ensureSdkProfile(runtimeOptions);
      if (!ensure.ok) {
        throw new Error(
          `SDK runtime profile setup failed: ${ensure.error ?? 'unknown error'} ` +
            '(install pnpm, or set DSH_LARK_ADAPTER=headless for the legacy adapter)',
        );
      }
      const launch = resolveSdkLaunch(runtimeOptions);
      return new SdkDshAdapter({
        launch,
        provider: env.provider,
        model: preferences.model ?? env.model,
        ...(env.maxTokens === undefined ? {} : { maxTokens: env.maxTokens }),
      });
    }
  }
}
