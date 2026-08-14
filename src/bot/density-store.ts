import type { CardDensity } from '../card/density.js';

/** Per-scope card density overrides on top of a default. */
export class DensityStore {
  private readonly overrides = new Map<string, CardDensity>();

  constructor(private readonly defaultDensity: CardDensity = 'standard') {}

  get(scope: string): CardDensity {
    return this.overrides.get(scope) ?? this.defaultDensity;
  }

  set(scope: string, density: CardDensity): void {
    this.overrides.set(scope, density);
  }

  clear(scope: string): boolean {
    return this.overrides.delete(scope);
  }
}
