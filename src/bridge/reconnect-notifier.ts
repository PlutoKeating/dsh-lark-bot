import type { CommandChannel } from '../commands/index.js';
import type { ScopeDirectory } from './scope-directory.js';

export class ReconnectNotifier {
  private startedAt: number | undefined;

  constructor(
    private readonly channel: CommandChannel,
    private readonly directory: ScopeDirectory | undefined,
    private readonly now: () => number = Date.now,
  ) {}

  async reconnecting(): Promise<void> {
    if (this.startedAt !== undefined) return;
    this.startedAt = this.now();
    await this.send('⚠️ 机器人连接不稳定，正在自动重连；期间的新消息可能延迟处理。');
  }

  async reconnected(): Promise<void> {
    if (this.startedAt === undefined) return;
    const elapsed = Math.max(0, this.now() - this.startedAt);
    this.startedAt = undefined;
    await this.send(`✅ 机器人连接已恢复（中断约 ${formatDuration(elapsed)}）。`);
  }

  private async send(markdown: string): Promise<void> {
    const target = this.directory?.recentDestination();
    if (!target) return;
    await this.channel.sendMarkdown(target.chatId, markdown, {
      ...(target.messageId ? { replyTo: target.messageId } : {}),
      ...(target.threadId ? { threadId: target.threadId } : {}),
    });
  }
}

function formatDuration(ms: number): string {
  if (ms < 1_000) return '不足 1 秒';
  if (ms < 60_000) return `${Math.round(ms / 1_000)} 秒`;
  return `${Math.round(ms / 60_000)} 分钟`;
}
