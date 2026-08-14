import type { Context } from '@deepseek-ai/cordis';
import { Service } from '@deepseek-ai/cordis';
import type { AgentAdapter } from './adapters/types.js';
import type { BridgeEngine } from './cli/commands/run.js';
import { startBridgeEngine } from './cli/commands/run.js';
import { loadRuntimeEnv, type RuntimeEnv } from './config/env.js';

/** Cordis plugin name; stable across releases (referenced by the bundle patch). */
export const name = 'dsh-lark-bot';

/** No hard service dependency: the bundle must never block a profile boot. */
export const inject: string[] = [];

export interface Config {
  /** Bridge bot profile name inside the bridge state store (default `default`). */
  profile?: string;
  /** Explicit `~/.dsh-lark` override (env `DSH_LARK_HOME`). */
  home?: string;
  /** Feishu/Lark app id (env `DSH_LARK_APP_ID`). */
  appId?: string;
  /** Feishu/Lark app secret (env `DSH_LARK_APP_SECRET`). */
  appSecret?: string;
  /** `feishu` or `lark` (env `DSH_LARK_TENANT`). */
  tenant?: string;
  /** Default workspace for new sessions (env `DSH_LARK_WORKSPACE`). */
  workspace?: string;
  /** Agent backend mode: `sdk` (default) / `acp` / `headless`. */
  adapter?: 'sdk' | 'acp' | 'headless';
  /** Default model (env `DSH_LARK_MODEL`). */
  model?: string;
  /** Set to true (or env `DSH_LARK_DISABLED=1`) to keep the bridge stopped. */
  disabled?: boolean;
}

/** Test-only dependency overrides; production rows configure through Config/env. */
export interface PluginDeps {
  env?: NodeJS.ProcessEnv;
  createChannel?: Parameters<typeof startBridgeEngine>[0]['createChannel'];
  adapter?: AgentAdapter;
}

export interface LarkBridgeStatus {
  state: 'starting' | 'running' | 'stopped';
  profile: string;
  home: string;
  adapterId: string;
  startedAt: string | undefined;
  workspace: string | undefined;
  notifyUrl: string | undefined;
}

/**
 * `larkBridge` service exposed to other in-process plugins: starts/stops the
 * bridge engine and reports its status. The engine runs inside the dsh
 * process (same event loop), so the Feishu channel, notify callback and the
 * nested dsh SDK runtime are all owned by the loaded plugin.
 */
export class LarkBridgeService extends Service {
  private engine: BridgeEngine | undefined;
  private startPromise: Promise<BridgeEngine> | undefined;

  constructor(ctx: Context) {
    super(ctx, 'larkBridge');
  }

  status(): LarkBridgeStatus {
    if (this.engine) {
      const status = this.engine.status();
      return { ...status, state: status.state === 'running' ? 'running' : 'stopped' };
    }
    return {
      state: this.startPromise ? 'starting' : 'stopped',
      profile: '',
      home: '',
      adapterId: '',
      startedAt: undefined,
      workspace: undefined,
      notifyUrl: undefined,
    };
  }

  start(config: Config = {}, deps: PluginDeps = {}): Promise<BridgeEngine> {
    if (this.startPromise) return this.startPromise;
    const env = envForConfig(config, deps.env ?? process.env);
    this.startPromise = startBridgeEngine({
      env,
      profileName: config.profile ?? 'default',
      allowOnboarding: true,
      ...(deps.createChannel ? { createChannel: deps.createChannel } : {}),
      ...(deps.adapter ? { adapter: deps.adapter } : {}),
    })
      .then((engine) => {
        this.engine = engine;
        return engine;
      })
      .finally(() => {
        this.startPromise = undefined;
      });
    return this.startPromise;
  }

  async stop(): Promise<void> {
    const engine = this.engine;
    this.engine = undefined;
    if (this.startPromise) {
      const pending = this.startPromise;
      this.startPromise = undefined;
      try {
        await pending;
      } catch {
        // The engine failed to start; nothing to stop.
        return;
      }
    }
    await engine?.stop();
  }
}

export function apply(ctx: Context, config: Config = {}, deps: PluginDeps = {}) {
  const service = new LarkBridgeService(ctx);
  const disabled = config.disabled === true || process.env.DSH_LARK_DISABLED === '1';
  ctx.logger.info(
    `[dsh-lark-bot] bundle loaded; bridge engine ${disabled ? 'disabled (DSH_LARK_DISABLED=1)' : 'will start in-process'}`,
  );
  if (!disabled) {
    void service
      .start(config, deps)
      .then((engine) => {
        ctx.logger.info(
          `[dsh-lark-bot] bridge engine running (profile=${engine.profile}, home=${engine.home})`,
        );
      })
      .catch((error: unknown) => {
        ctx.logger.warn(
          `[dsh-lark-bot] bridge engine failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }
  // Cordis uses the plugin's returned disposer to run cleanup when the fiber
  // unloads (profile stop / reload / `dsh plugin remove`).
  return (): void => {
    void service.stop();
  };
}

function envForConfig(config: Config, base: NodeJS.ProcessEnv): RuntimeEnv {
  const env = { ...base };
  if (config.home) env.DSH_LARK_HOME = config.home;
  if (config.tenant) env.DSH_LARK_TENANT = config.tenant;
  if (config.appId) env.DSH_LARK_APP_ID = config.appId;
  if (config.appSecret) env.DSH_LARK_APP_SECRET = config.appSecret;
  if (config.workspace) env.DSH_LARK_WORKSPACE = config.workspace;
  if (config.adapter) env.DSH_LARK_ADAPTER = config.adapter;
  if (config.model) env.DSH_LARK_MODEL = config.model;
  return loadRuntimeEnv(env);
}
