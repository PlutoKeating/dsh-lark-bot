export interface ActiveRunHandle {
  runId: string;
  stop(): Promise<void>;
}

export class ActiveRuns {
  private readonly runs = new Map<string, ActiveRunHandle>();

  set(scope: string, handle: ActiveRunHandle): void {
    this.runs.set(scope, handle);
  }

  get(scope: string): ActiveRunHandle | undefined {
    return this.runs.get(scope);
  }

  delete(scope: string): boolean {
    return this.runs.delete(scope);
  }

  async interrupt(scope: string): Promise<boolean> {
    const handle = this.runs.get(scope);
    if (!handle) return false;
    this.runs.delete(scope);
    await handle.stop();
    return true;
  }
}
