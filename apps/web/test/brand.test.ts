import { describe, expect, it } from 'vitest';
import { brand } from '../lib/brand';

describe('brand palette', () => {
  it('carries the BrewCult cream/espresso anchors', () => {
    expect(brand.cream).toBe('#F4EDE3');
    expect(brand.espresso).toBe('#3B2A20');
  });
});
