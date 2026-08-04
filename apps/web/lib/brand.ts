/**
 * BrewCult brand palette (docs/brand). The full design-token setup arrives
 * with the Wave-2 web shell; these two anchors exist so the skeleton renders
 * on-brand from day one.
 */
export const brand = {
  /** Warm cream — background. */
  cream: '#F4EDE3',
  /** Deep espresso — text / ink. */
  espresso: '#3B2A20',
} as const;

export type Brand = typeof brand;
