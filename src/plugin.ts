import type { Context } from '@deepseek-ai/cordis';
import { Service } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import {
  settingsNamespace,
} from '@deepseek-ai/dsh-settings';
import type { AgentAdapter } from './adapters/types.js';
import type { BridgeEngine } from './cli/commands/run.js';
import { startBridgeEngine } from './cli/commands/run.js';
import { loadRuntimeEnv, type RuntimeEnv } from './config/env.js';
import { resolveAppPaths } from './config/app-paths.js';
import { ConfigStore } from './config/profile-store.js';
import { attachOptionalTuiSeams } from './tui/optional-seams.js';

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
  tenant?: 'feishu' | 'lark';
  /** Default workspace for new sessions (env `DSH_LARK_WORKSPACE`). */
  workspace?: string;
  /** Agent backend mode: `sdk` (default) / `acp` / `headless` / `web`. */
  adapter?: 'sdk' | 'acp' | 'headless' | 'web';
  /** Local DSH Web host used for single-writer session projection. */
  webUrl?: string;
  /** Explicit session projection switch (web mode only; default true). */
  sessionProjection?: boolean;
  /** Default model (env `DSH_LARK_MODEL`). */
  model?: string;
  /** Max agent runs accepted concurrently in one scope. */
  scopeConcurrency?: number;
  /** Default proactive reminders for scopes without their own preference. */
  notificationDefault?: 'off' | 'completed' | 'all';
  /** Set to true (or env `DSH_LARK_DISABLED=1`) to keep the bridge stopped. */
  disabled?: boolean;
}

export const DSH_LARK_SETTINGS_NAMESPACE = settingsNamespace('dsh-lark-bot');

/**
 * Cordis configuration schema. dsh Web discovers this through the registered
 * settings namespace; the secret role guarantees App Secret is write-only on
 * every redacted browser response.
 */
export const Config = Schema.object({
  profile: Schema.string()
    .description('机器人配置名称；通常保持 default / Bot profile name; usually keep default'),
  home: Schema.string()
    .description('本地数据目录；修改后自动重连 / Local state directory; reconnects after saving'),
  tenant: Schema.union(['feishu', 'lark'])
    .description('服务区域：中国大陆选飞书，海外选 Lark / Region: Feishu for China, Lark elsewhere'),
  appId: Schema.string()
    .description('飞书/Lark 应用 ID，例如 cli_xxx；保存后自动重连 / App ID; reconnects after saving'),
  appSecret: Schema.string()
    .role('secret')
    .description('应用密钥；只写不回显，保存后自动重连 / App Secret; write-only and reconnects after saving'),
  workspace: Schema.string()
    .description('新会话默认打开的项目文件夹 / Default project folder for new sessions'),
  adapter: Schema.union(['sdk', 'acp', 'headless', 'web'])
    .description('运行方式；推荐 sdk，保存后自动重连 / Runtime mode; sdk is recommended'),
  webUrl: Schema.string()
    .description('仅 web 模式使用的本机 dsh Web 地址 / Local dsh Web address used only in web mode'),
  sessionProjection: Schema.boolean()
    .description('web 模式下同步 dsh 会话到飞书 / Mirror dsh sessions to Feishu in web mode'),
  model: Schema.string()
    .description('新任务默认使用的 provider/model 路由 / Default provider/model route for new tasks'),
  scopeConcurrency: Schema.number()
    .step(1)
    .min(1)
    .max(32)
    .description('每个会话同时运行的任务数，建议 1–4 / Parallel tasks per session; 1–4 recommended'),
  notificationDefault: Schema.union(['off', 'completed', 'all'])
    .description('未单独设置会话时的提醒：关闭、仅完成/失败、全部 / Default proactive reminders'),
  disabled: Schema.boolean()
    .description('暂停机器人；保存后立即停止 / Pause the bot immediately'),
}) as unknown as Schema<Config>;

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
  private stopPromise: Promise<void> | undefined;

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

  updateSafeSettings(config: Config, deps: PluginDeps = {}): void {
    const env = envForConfig(config, deps.env ?? process.env);
    this.engine?.updateSafeSettings({
      model: env.model,
      scopeConcurrency: env.scopeConcurrency,
      notificationDefault: env.notificationDefault,
    });
  }

  async stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    const stopping = (async () => {
      let engine = this.engine;
      if (this.startPromise) {
        try {
          engine = await this.startPromise;
        } catch {
          // The engine failed to start; nothing to stop.
          return;
        }
      }
      if (this.engine === engine) this.engine = undefined;
      await engine?.stop();
    })();
    this.stopPromise = stopping.finally(() => {
      this.stopPromise = undefined;
    });
    return this.stopPromise;
  }
}

export function apply(ctx: Context, config: Config = {}, deps: PluginDeps = {}) {
  const service = new LarkBridgeService(ctx);
  const detachTui = attachOptionalTuiSeams(ctx);
  let source = () => config;
  let appliedConfig: Config | undefined;
  let revision = 0;
  let disposed = false;
  let reconcileQueue = Promise.resolve();
  const baseConfig = hydrateSettingsBase(config, deps.env ?? process.env);

  const reconcile = (): void => {
    const desired = source();
    if (appliedConfig && sameConfig(desired, appliedConfig)) return;
    const ticket = ++revision;
    reconcileQueue = reconcileQueue
      .catch(() => undefined)
      .then(async () => {
        if (disposed || ticket !== revision) return;
        if (appliedConfig && sameRestartConfig(desired, appliedConfig)) {
          service.updateSafeSettings(desired, deps);
          appliedConfig = desired;
          return;
        }
        await service.stop();
        if (disposed || ticket !== revision) return;
        if (!isDisabled(desired)) {
          const engine = await service.start(desired, deps);
          ctx.logger.info(
            `[dsh-lark-bot] bridge engine running (profile=${engine.profile}, home=${engine.home})`,
          );
        }
        appliedConfig = desired;
      })
      .catch((error: unknown) => {
        ctx.logger.warn(
          `[dsh-lark-bot] Web settings reload failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  };

  void baseConfig.then((base) => {
    if (disposed) return;
    source = () => base;
    reconcile();
  }).catch((error: unknown) => {
    ctx.logger.warn(
      `[dsh-lark-bot] failed to hydrate Web settings: ${error instanceof Error ? error.message : String(error)}`,
    );
    if (!disposed) reconcile();
  });

  ctx.inject(['settings'], async (settingsContext) => {
    const base = await baseConfig;
    if (disposed) return;
    const scope = settingsContext.settings.register(
      DSH_LARK_SETTINGS_NAMESPACE,
      Config,
      { base, applies: 'live' },
    );
    source = () => scope.get();
    reconcile();
    const unwatch = scope.watch(() => { reconcile(); });
    settingsContext.effect(() => () => {
      unwatch();
      if (disposed) return;
      source = () => base;
      reconcile();
    });
  });

  const disabled = isDisabled(config);
  ctx.logger.info(
    `[dsh-lark-bot] bundle loaded; bridge engine ${disabled ? 'disabled (DSH_LARK_DISABLED=1)' : 'will start in-process'}`,
  );
  // Cordis uses the plugin's returned disposer to run cleanup when the fiber
  // unloads (profile stop / reload / `dsh plugin remove`).
  return async (): Promise<void> => {
    disposed = true;
    revision += 1;
    detachTui();
    await reconcileQueue;
    await service.stop();
  };
}

async function hydrateSettingsBase(config: Config, baseEnv: NodeJS.ProcessEnv): Promise<Config> {
  const runtime = envForConfig(config, baseEnv);
  const store = new ConfigStore(resolveAppPaths(runtime.home).configFile);
  await store.load();
  const profile = store.getProfile(config.profile ?? 'default');
  if (!profile) return config;
  const explicitBinding = Boolean(config.appId && config.appSecret);
  const hydrated: Config = {
    ...config,
    tenant: explicitBinding ? (config.tenant ?? profile.tenant) : profile.tenant,
    appId: config.appId ?? profile.accounts.appId,
    appSecret: config.appSecret ?? profile.accounts.appSecret,
  };
  const workspace = explicitBinding
    ? (config.workspace ?? profile.workspaces.default)
    : (profile.workspaces.default ?? config.workspace);
  const model = explicitBinding
    ? (config.model ?? profile.preferences.model)
    : (profile.preferences.model ?? config.model);
  if (workspace !== undefined) hydrated.workspace = workspace;
  if (model !== undefined) hydrated.model = model;
  return hydrated;
}

function isDisabled(config: Config): boolean {
  return config.disabled === true || process.env.DSH_LARK_DISABLED === '1';
}

function sameConfig(left: Config, right: Config): boolean {
  const keys: Array<keyof Config> = [
    'profile', 'home', 'appId', 'appSecret', 'tenant', 'workspace', 'adapter',
    'webUrl', 'sessionProjection', 'model', 'scopeConcurrency',
    'notificationDefault', 'disabled',
  ];
  return keys.every((key) => left[key] === right[key]);
}

function sameRestartConfig(left: Config, right: Config): boolean {
  const keys: Array<keyof Config> = [
    'profile', 'home', 'appId', 'appSecret', 'tenant', 'workspace', 'adapter',
    'webUrl', 'sessionProjection', 'disabled',
  ];
  return keys.every((key) => left[key] === right[key]);
}

function envForConfig(config: Config, base: NodeJS.ProcessEnv): RuntimeEnv {
  const env = { ...base };
  if (config.home) env.DSH_LARK_HOME = config.home;
  if (config.tenant) env.DSH_LARK_TENANT = config.tenant;
  if (config.appId) env.DSH_LARK_APP_ID = config.appId;
  if (config.appSecret) env.DSH_LARK_APP_SECRET = config.appSecret;
  if (config.workspace) env.DSH_LARK_WORKSPACE = config.workspace;
  if (config.adapter) env.DSH_LARK_ADAPTER = config.adapter;
  if (config.webUrl) env.DSH_LARK_WEB_URL = config.webUrl;
  if (config.sessionProjection !== undefined) {
    env.DSH_LARK_SESSION_PROJECTION = config.sessionProjection ? '1' : '0';
  }
  if (config.model) env.DSH_LARK_MODEL = config.model;
  if (config.scopeConcurrency !== undefined) {
    env.DSH_LARK_SCOPE_CONCURRENCY = String(config.scopeConcurrency);
  }
  if (config.notificationDefault) {
    env.DSH_LARK_NOTIFICATION_DEFAULT = config.notificationDefault;
  }
  return loadRuntimeEnv(env);
}
