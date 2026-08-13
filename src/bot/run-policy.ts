export class RunPolicyStore {
  private readonly timeouts = new Map<string, number>();

  get(scope: string): number | undefined {
    return this.timeouts.get(scope);
  }

  set(scope: string, runTimeoutMs: number): void {
    this.timeouts.set(scope, runTimeoutMs);
  }

  clear(scope: string): boolean {
    return this.timeouts.delete(scope);
  }
}
