export interface ActiveRunHandle {
  runId: string;
  stop(): Promise<void>;
}

/**
 * Tracks every running agent run, keyed by scope. A scope can hold several
 * concurrent runs (multi-agent collaboration); `interrupt` stops them all,
 * while `interruptRun` targets one run by id.
 */
export class ActiveRuns {
  private readonly runs = new Map<string, Map<string, ActiveRunHandle>>();

  set(scope: string, handle: ActiveRunHandle): void {
    const scoped = this.runs.get(scope) ?? new Map<string, ActiveRunHandle>();
    scoped.set(handle.runId, handle);
    this.runs.set(scope, scoped);
  }

  /** First active run for the scope, if any (backward-compatible accessor). */
  get(scope: string): ActiveRunHandle | undefined {
    return this.runs.get(scope)?.values().next().value;
  }

  list(scope: string): ActiveRunHandle[] {
    return [...(this.runs.get(scope)?.values() ?? [])];
  }

  count(scope: string): number {
    return this.runs.get(scope)?.size ?? 0;
  }

  has(scope: string): boolean {
    return (this.runs.get(scope)?.size ?? 0) > 0;
  }

  delete(scope: string, runId: string): boolean {
    const scoped = this.runs.get(scope);
    if (!scoped) return false;
    const removed = scoped.delete(runId);
    if (scoped.size === 0) this.runs.delete(scope);
    return removed;
  }

  /** Stop every active run in the scope. Returns how many were interrupted. */
  async interrupt(scope: string): Promise<number> {
    const scoped = this.runs.get(scope);
    if (!scoped || scoped.size === 0) return 0;
    const handles = [...scoped.values()];
    this.runs.delete(scope);
    await Promise.allSettled(handles.map((handle) => handle.stop()));
    return handles.length;
  }

  /** Stop one run by id. Returns whether the run existed. */
  async interruptRun(scope: string, runId: string): Promise<boolean> {
    const scoped = this.runs.get(scope);
    const handle = scoped?.get(runId);
    if (!handle) return false;
    scoped?.delete(runId);
    if (scoped?.size === 0) this.runs.delete(scope);
    await handle.stop();
    return true;
  }
}
