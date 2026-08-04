import { describe, expect, it } from 'vitest';
import { brand, contrastRatio, palette } from '../lib/brand';

describe('brand palette', () => {
  it('carries the BrewCult cream/espresso anchors', () => {
    expect(brand.cream).toBe('#F4EDE3');
    expect(brand.espresso).toBe('#3B2A20');
  });

  it('keeps the mark colours to the two anchors', () => {
    // USAGE.md §Colors — the mark is only ever these two, either way round.
    expect(palette.cream).toBe(brand.cream);
    expect(palette.espresso).toBe(brand.espresso);
  });
});

describe('contrast (WCAG 2.1)', () => {
  it('body text clears AAA in both directions', () => {
    expect(contrastRatio(brand.espresso, brand.cream)).toBeGreaterThanOrEqual(7);
  });

  it('secondary text clears AA on light and on dark', () => {
    expect(contrastRatio(palette.inkMuted, palette.cream)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.inkMutedReversed, palette.espresso)).toBeGreaterThanOrEqual(4.5);
  });

  it('error text clears AA on its own background', () => {
    expect(contrastRatio(palette.danger, palette.cream)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.dangerReversed, palette.espresso)).toBeGreaterThanOrEqual(4.5);
  });

  it('primary buttons (inverted ink) stay readable', () => {
    expect(contrastRatio(palette.cream, palette.espresso)).toBeGreaterThanOrEqual(7);
  });

  it('text on raised surfaces still clears AA', () => {
    expect(contrastRatio(palette.espresso, palette.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.cream, palette.surfaceReversed)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.inkMuted, palette.surface)).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(palette.inkMutedReversed, palette.surfaceReversed),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
