/**
 * Per-scope live-message retention overrides. `undefined` means the profile /
 * environment default applies. Mirrors `RunPolicyStore` semantics.
 */
export class RetentionStore {
  private readonly retentions = new Map<string, number>();

  get(scope: string): number | undefined {
    return this.retentions.get(scope);
  }

  set(scope: string, retention: number): void {
    this.retentions.set(scope, retention);
  }

  clear(scope: string): boolean {
    return this.retentions.delete(scope);
  }
}
