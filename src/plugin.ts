import type { Context } from '@deepseek-ai/cordis';
import { Service } from '@deepseek-ai/cordis';
import { resolveAppPaths } from './config/app-paths.js';
import { ServiceManager } from './service/manager.js';
import type { ServiceStatus } from './service/types.js';

/** Cordis plugin name; stable across releases (referenced by the bundle patch). */
export const name = 'dsh-lark-bot';

/** No hard service dependency: the bundle must never block a profile boot. */
export const inject: string[] = [];

export interface Config {
  /** Bridge profile managed by this bundle (defaults to `default`). */
  profile?: string;
  /** Start the standalone bridge when the profile boots (env `DSH_LARK_AUTOSTART=1`). */
  autostart?: boolean;
  /** Explicit `~/.dsh-lark` override (env `DSH_LARK_HOME`). */
  home?: string;
}

/**
 * `larkBridge` service exposed to other in-process plugins: manages the
 * standalone dsh-lark-bot background service (start / status / restart /
 * stop) through the same controllers the CLI uses.
 */
export class LarkBridgeService extends Service {
  private readonly manager: ServiceManager;

  constructor(ctx: Context, manager: ServiceManager) {
    super(ctx, 'larkBridge');
    this.manager = manager;
  }

  status(): Promise<ServiceStatus> {
    return this.manager.status();
  }

  start(): Promise<ServiceStatus> {
    return this.manager.start();
  }

  restart(): Promise<ServiceStatus> {
    return this.manager.restart();
  }

  stop(): Promise<ServiceStatus> {
    return this.manager.stop();
  }
}

export function apply(
  ctx: Context,
  config: Config = {},
  managerOverride?: ServiceManager,
) {
  const profile = config.profile ?? 'default';
  const manager =
    managerOverride ??
    new ServiceManager({
      profile,
      ...(config.home ? { paths: resolveAppPaths(config.home) } : {}),
    });
  const bridge = new LarkBridgeService(ctx, manager);
  ctx.logger.info(`[dsh-lark-bot] bundle loaded; bridge service available as ctx.larkBridge (profile=${profile})`);
  if (config.autostart === true) {
    void bridge.start().catch((error: unknown) => {
      ctx.logger.warn(
        `[dsh-lark-bot] autostart failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }
  return bridge;
}
