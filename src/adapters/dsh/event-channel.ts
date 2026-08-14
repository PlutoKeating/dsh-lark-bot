/** Ordered async queue used to stream translated events out of a run. */
export class EventChannel<T> implements AsyncIterable<T> {
  private readonly queue: T[] = [];
  private readonly waiters: Array<(event: T) => void> = [];
  private closed = false;

  push(event: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(event);
    } else {
      this.queue.push(event);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter(undefined as unknown as T);
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    for (;;) {
      const queued = this.queue.shift();
      if (queued !== undefined) {
        yield queued;
        continue;
      }
      if (this.closed) return;
      yield await new Promise<T>((resolve) => {
        this.waiters.push(resolve);
      });
    }
  }
}
