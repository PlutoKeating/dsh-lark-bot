export class ModelStore {
  private readonly overrides = new Map<string, string>();

  get(scope: string): string | undefined {
    return this.overrides.get(scope);
  }

  set(scope: string, model: string): void {
    this.overrides.set(scope, model);
  }

  clear(scope: string): boolean {
    return this.overrides.delete(scope);
  }
}
