/**
 * BrewCult brand palette + design tokens (docs/brand).
 *
 * Brand law (docs/brand/core-mark/USAGE.md §Colors, wordmark §Rules 5):
 * the mark and wordmark are Espresso #3B2A20 on Cream #F4EDE3 — or the straight
 * reversed swap. Never other colors, gradients or shadows.
 *
 * Everything else in `palette` is a *blend of those two anchors* (an alpha
 * percentage of espresso over cream, or cream over espresso) so the UI never
 * introduces a third brand hue. The two exceptions are the error tones, which
 * exist because "this field is wrong" must not be communicated by colour alone
 * *or* by a colour nobody reads as a warning; both are warm and derived from the
 * espresso family. See `contrastRatio` + test/brand.test.ts for the WCAG proof.
 */
export const brand = {
  /** Warm cream — background. */
  cream: '#F4EDE3',
  /** Deep espresso — text / ink. */
  espresso: '#3B2A20',
} as const;

export type Brand = typeof brand;

export const palette = {
  cream: brand.cream,
  espresso: brand.espresso,

  // --- light mode (espresso on cream) ---
  /** 72% espresso over cream — secondary text. */
  inkMuted: '#6F6157',
  /** 12% espresso over cream — hairlines, borders. */
  line: '#DED6CC',
  /** 6% espresso over cream — raised surfaces (cards, inputs). */
  surface: '#E9E1D7',

  // --- dark mode (reversed: cream on espresso) ---
  /** 78% cream over espresso — secondary text, reversed. */
  inkMutedReversed: '#CBC2B8',
  /** 22% cream over espresso — hairlines, reversed. */
  lineReversed: '#64554B',
  /** 8% cream over espresso — raised surfaces, reversed. */
  surfaceReversed: '#4A3A30',

  // --- state ---
  /** Warm brick, for form errors on cream. */
  danger: '#8C2F1E',
  /** Warm clay, for form errors on espresso. */
  dangerReversed: '#E9A08C',
} as const;

export type Palette = typeof palette;

/** Space Grotesk is the brand typeface (docs/brand/wordmark/WORDMARK-NOTES.md). */
export const BRAND_TYPEFACE = 'Space Grotesk' as const;

/* ------------------------------------------------------------------ *
 * Contrast helpers — used by tests to assert the palette is WCAG-sane.
 * ------------------------------------------------------------------ */

function channelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.1 relative luminance of a `#rrggbb` colour. */
export function relativeLuminance(hex: string): number {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) throw new Error(`Not a 6-digit hex colour: ${hex}`);
  const value = Number.parseInt(match[1], 16);
  const r = channelToLinear((value >> 16) & 0xff);
  const g = channelToLinear((value >> 8) & 0xff);
  const b = channelToLinear(value & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio between two `#rrggbb` colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [light, dark] = la > lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}
