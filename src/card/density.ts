export type CardDensity = 'compact' | 'standard' | 'detailed';

export const CARD_DENSITIES: readonly CardDensity[] = ['compact', 'standard', 'detailed'];

export function parseCardDensity(value: string | undefined): CardDensity | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if ((CARD_DENSITIES as readonly string[]).includes(normalized)) {
    return normalized as CardDensity;
  }
  return undefined;
}
