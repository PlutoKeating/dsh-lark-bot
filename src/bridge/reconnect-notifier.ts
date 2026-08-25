import type { CommandChannel } from '../commands/index.js';
import type { ScopeDirectory } from './scope-directory.js';
import { bilingualMarkdown } from '../card/i18n.js';

interface FaultTitle {
  zh: string;
  en: string;
}

export class ReconnectNotifier {
  private startedAt: number | undefined;

  constructor(
    private readonly channel: CommandChannel,
    private readonly directory: ScopeDirectory | undefined,
    private readonly now: () => number = Date.now,
    private readonly reconciliation?: (scope: string) => { zhCn: string; enUs: string },
    /** Optional outbound sink fan-out for the reconnect fault class (issue #113). */
    private readonly onFault?: (scope: string, title: FaultTitle, detail?: string) => Promise<void>,
  ) {}

  async reconnecting(): Promise<void> {
    if (this.startedAt !== undefined) return;
    this.startedAt = this.now();
    const zhCn = '⚠️ 机器人连接不稳定，正在自动重连；期间的新消息可能延迟处理。';
    const enUs = '⚠️ The bot connection is unstable and reconnecting automatically. New messages may be delayed.';
    await this.send(zhCn, enUs);
    await this.fault(this.directory?.recentDestination()?.scope, { zh: zhCn, en: enUs });
  }

  async reconnected(): Promise<void> {
    if (this.startedAt === undefined) return;
    const elapsed = Math.max(0, this.now() - this.startedAt);
    this.startedAt = undefined;
    const target = this.directory?.recentDestination();
    const summary = target ? this.reconciliation?.(target.scope) : undefined;
    const zhCn = `✅ 机器人连接已恢复（中断约 ${formatDuration(elapsed)}）。${summary ? `\n${summary.zhCn}` : ''}`;
    const enUs = `✅ The bot connection recovered after about ${formatDurationEnglish(elapsed)}.${summary ? `\n${summary.enUs}` : ''}`;
    await this.send(zhCn, enUs);
    await this.fault(target?.scope, { zh: zhCn, en: enUs });
  }

  private async send(zhCn: string, enUs: string): Promise<void> {
    const target = this.directory?.recentDestination();
    if (!target) return;
    await this.channel.sendMarkdown(target.chatId, bilingualMarkdown(zhCn, enUs), {
      ...(target.messageId ? { replyTo: target.messageId } : {}),
      ...(target.threadId ? { threadId: target.threadId } : {}),
    });
  }

  private async fault(scope: string | undefined, title: FaultTitle): Promise<void> {
    if (!scope || !this.onFault) return;
    try {
      await this.onFault(scope, title);
    } catch (error) {
      // Never fail the reconnect path because a sink fan-out failed.
    }
  }
}

function formatDurationEnglish(ms: number): string {
  if (ms < 1_000) return 'less than 1 second';
  if (ms < 60_000) return `${Math.round(ms / 1_000)} seconds`;
  return `${Math.round(ms / 60_000)} minutes`;
}

function formatDuration(ms: number): string {
  if (ms < 1_000) return '不足 1 秒';
  if (ms < 60_000) return `${Math.round(ms / 1_000)} 秒`;
  return `${Math.round(ms / 60_000)} 分钟`;
}
