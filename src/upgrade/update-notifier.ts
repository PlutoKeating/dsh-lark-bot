import { isNewer, latestVersion, markNotified } from './update-check.js';

/**
 * Periodic "new version available" detector for the bridge engine (issue
 * #15). Checks npm latest at a configurable interval, dedupes per version and
 * either pushes a Feishu notification to a configured chat or logs the update
 * (or both). Never throws: a registry hiccup only means "no update this
 * round". `DSH_LARK_UPGRADE_CHECK=0` disables the probe (handled by
 * `latestVersion`).
 */
export interface UpdateNotifierOptions {
  /** Currently running package version. */
  current: string;
  /** Push a Feishu notification when a newer version is found. */
  notify: boolean;
  /** Chat to receive notifications (required for `notify`). */
  notifyChat?: string | undefined;
  /** Check interval in ms (0 disables the timer). */
  intervalMs: number;
  /** Injectable probe (tests); defaults to the cached `latestVersion`. */
  probe?: () => Promise<string | undefined>;
  /** Injectable outbound send (tests). */
  send?: (chatId: string, markdown: string) => Promise<void>;
  log?: { warn(category: string, event: string, fields?: unknown): void };
}

export interface UpdateCheckOutcome {
  latest: string | undefined;
  /** True when this version was announced for the first time. */
  notified: boolean;
}

export class UpdateNotifier {
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;

  constructor(private readonly options: UpdateNotifierOptions) {}

  start(): void {
    if (this.stopped || this.options.intervalMs <= 0) return;
    this.timer = setInterval(() => {
      void this.checkNow();
    }, this.options.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  async checkNow(): Promise<UpdateCheckOutcome> {
    if (this.stopped) return { latest: undefined, notified: false };
    const latest = this.options.probe
      ? await this.options.probe()
      : await latestVersion();
    if (latest === undefined || !isNewer(latest, this.options.current)) {
      return { latest, notified: false };
    }
    const firstTime = markNotified(latest);
    if (firstTime && this.options.notify && this.options.send && this.options.notifyChat) {
      try {
        await this.options.send(
          this.options.notifyChat,
          [
            `⬆️ **发现新版本 ${latest}**（当前 ${this.options.current}）`,
            '管理员可执行 `dsh-lark-bot upgrade` 一键更新（配置 / 会话 / 凭据不受影响）。',
          ].join('\n'),
        );
      } catch {
        // Best effort — never let a notification failure surface.
      }
    }
    this.options.log?.warn('upgrade', 'update-available', {
      current: this.options.current,
      latest,
    });
    return { latest, notified: firstTime };
  }
}
