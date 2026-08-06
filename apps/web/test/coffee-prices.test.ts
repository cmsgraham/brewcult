/**
 * Money parsing (0018) — the two-parsers rule.
 *
 * "8.500" is eight and a half thousand colones AND eight dollars fifty. One
 * parser for both currencies read the colones form dollar-style and saved it
 * three orders of magnitude wrong, without an error — which is how the person
 * who found it experienced "cannot add a price in colones".
 */
import { describe, expect, it } from 'vitest';
import { formatColones, parseColones, parseDollars } from '../lib/coffee-offers-client';

describe('parsing colones', () => {
  it('reads every Costa Rican way of writing eight and a half thousand', () => {
    for (const written of ['8500', '8.500', '8,500', '₡8.500', '₡ 8500', '8 500']) {
      expect(parseColones(written)).toBe(8500);
    }
  });

  it('treats a dot as thousands, never as a decimal', () => {
    // There are no céntimos in practice; a decimal colón price does not exist.
    expect(parseColones('8.5')).toBe(85);
    expect(parseColones('12.000')).toBe(12000);
  });

  it('answers undefined for an empty field, not zero', () => {
    expect(parseColones('')).toBeUndefined();
    expect(parseColones('   ')).toBeUndefined();
    expect(parseColones('₡')).toBeUndefined();
  });
});

describe('parsing dollars', () => {
  it('keeps the dot as a decimal and drops commas and symbols', () => {
    expect(parseDollars('16.50')).toBe(16.5);
    expect(parseDollars('$16.50')).toBe(16.5);
    expect(parseDollars('1,250.75')).toBe(1250.75);
  });

  it('answers undefined for nothing', () => {
    expect(parseDollars('')).toBeUndefined();
    expect(parseDollars('$')).toBeUndefined();
    expect(parseDollars('.')).toBeUndefined();
  });
});

describe('formatting colones', () => {
  it('never shows céntimos', () => {
    // es-CR groups with a separator; the digits and the absence of decimals are
    // the contract, the exact separator glyph is the locale's business.
    expect(formatColones(8500).replace(/\D/g, '')).toBe('8500');
    expect(formatColones(8500)).not.toContain(',00');
  });
});
