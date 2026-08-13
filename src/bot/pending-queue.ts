export type PendingFlush<T> = (scope: string, batch: T[]) => void | Promise<void>;

export class PendingQueue<T> {
  private readonly pending = new Map<string, T[]>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly blocked = new Set<string>();
  private readonly flushing = new Set<string>();

  constructor(
    private readonly quietMs: number,
    private readonly onFlush: PendingFlush<T>,
  ) {}

  push(scope: string, item: T): void {
    const batch = this.pending.get(scope) ?? [];
    batch.push(item);
    this.pending.set(scope, batch);
    this.schedule(scope);
  }

  block(scope: string): void {
    this.blocked.add(scope);
    this.clearTimer(scope);
  }

  unblock(scope: string): void {
    this.blocked.delete(scope);
    this.schedule(scope);
  }

  async flushNow(scope: string): Promise<void> {
    this.clearTimer(scope);
    if (this.flushing.has(scope)) return;

    const batch = this.pending.get(scope) ?? [];
    this.pending.delete(scope);
    if (batch.length === 0) return;

    this.flushing.add(scope);
    try {
      await this.onFlush(scope, batch);
    } finally {
      this.flushing.delete(scope);
    }
  }

  hasPending(scope: string): boolean {
    return (this.pending.get(scope)?.length ?? 0) > 0;
  }

  isBlocked(scope: string): boolean {
    return this.blocked.has(scope);
  }

  private schedule(scope: string): void {
    if (this.blocked.has(scope) || this.flushing.has(scope)) return;
    if (this.timers.has(scope)) return;
    if (!this.hasPending(scope)) return;

    this.timers.set(
      scope,
      setTimeout(() => {
        this.timers.delete(scope);
        void this.flushNow(scope);
      }, this.quietMs),
    );
  }

  private clearTimer(scope: string): void {
    const timer = this.timers.get(scope);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.timers.delete(scope);
  }
}
