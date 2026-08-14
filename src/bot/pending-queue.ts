export type PendingFlush<T> = (scope: string, batch: T[]) => void | Promise<void>;

/**
 * Per-scope debounced message queue with bounded concurrency. A scope may run
 * several flushes in parallel up to `concurrencyFor(scope)`; `block` stops
 * NEW flushes from starting while already-running ones finish, and `unblock`
 * resumes scheduling.
 */
export class PendingQueue<T> {
  private readonly pending = new Map<string, T[]>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly blocked = new Set<string>();
  private readonly flushingCount = new Map<string, number>();

  constructor(
    private readonly quietMs: number,
    private readonly onFlush: PendingFlush<T>,
    private readonly concurrencyFor: (scope: string) => number = () => 1,
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
    const limit = this.concurrencyFor(scope);
    const active = this.flushingCount.get(scope) ?? 0;
    if (active >= limit) return;

    const batch = this.pending.get(scope) ?? [];
    this.pending.delete(scope);
    if (batch.length === 0) return;

    this.flushingCount.set(scope, active + 1);
    try {
      await this.onFlush(scope, batch);
    } finally {
      const next = (this.flushingCount.get(scope) ?? 1) - 1;
      if (next <= 0) this.flushingCount.delete(scope);
      else this.flushingCount.set(scope, next);
      this.schedule(scope);
    }
  }

  hasPending(scope: string): boolean {
    return (this.pending.get(scope)?.length ?? 0) > 0;
  }

  isBlocked(scope: string): boolean {
    return this.blocked.has(scope);
  }

  isFlushing(scope: string): boolean {
    return (this.flushingCount.get(scope) ?? 0) > 0;
  }

  activeFlushes(scope: string): number {
    return this.flushingCount.get(scope) ?? 0;
  }

  private schedule(scope: string): void {
    if (this.blocked.has(scope)) return;
    if ((this.flushingCount.get(scope) ?? 0) >= this.concurrencyFor(scope)) return;
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
