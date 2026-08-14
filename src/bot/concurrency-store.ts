/**
 * Per-scope concurrent-run overrides. `undefined` means the profile /
 * environment default applies. Mirrors `RunPolicyStore` semantics.
 */
export class ConcurrencyStore {
  private readonly limits = new Map<string, number>();

  get(scope: string): number | undefined {
    return this.limits.get(scope);
  }

  set(scope: string, limit: number): void {
    this.limits.set(scope, limit);
  }

  clear(scope: string): boolean {
    return this.limits.delete(scope);
  }
}
