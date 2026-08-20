import type { Context } from '@deepseek-ai/cordis';
import { log } from '../core/logger.js';

interface TuiStatusLike {
  set(key: string, value: string | undefined): (() => void) | undefined;
}

interface TuiPluginHostLike {
  descriptor?: () => unknown;
}

/**
 * Attach only presentation-neutral, optional TUI affordances. Session/event
 * projection never depends on these seams and does not subscribe to
 * messages.observe or session-switch/input interception.
 */
export function attachOptionalTuiSeams(ctx: Context): () => void {
  const get = (ctx as unknown as { get?: Context['get'] }).get;
  if (typeof get !== 'function') return () => undefined;
  const host = get.call(ctx, 'tuiPluginHost', false) as TuiPluginHostLike | undefined;
  const status = get.call(ctx, 'tuiStatus', false) as TuiStatusLike | undefined;
  if (!host && !status) return () => undefined;
  let disposeStatus: (() => void) | undefined;
  try {
    // Descriptor presence is diagnostic only. The host owns authoritative
    // admission and each runtime generation; no descriptor is cached here.
    const descriptorAvailable = host?.descriptor?.() !== undefined;
    disposeStatus = status?.set(
      'dsh-lark-bot:bridge',
      descriptorAvailable ? '飞书桥接已加载' : '飞书桥接（兼容降级）',
    );
    log.info('tui-compat', 'optional-seams-attached', { descriptorAvailable });
  } catch (error) {
    log.warn('tui-compat', 'optional-seams-unavailable', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return () => {
    try { disposeStatus?.(); } catch (error) {
      log.warn('tui-compat', 'status-cleanup-failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
