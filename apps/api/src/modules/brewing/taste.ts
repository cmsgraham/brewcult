/**
 * Taste → extraction diagnosis (§6.7, §7.1).
 *
 * THE MAPPING IS SERVER-AUTHORITATIVE. It exists in exactly two places: this
 * function, and the `brew_sessions.diagnosis` generated column in
 * 0006_brewing.sql. Both are asserted to agree by the test suite. It is
 * deliberately NOT duplicated in any client, because a logger that showed
 * "under-extracted" while the AI stored "balanced" would destroy trust in both.
 *
 * The vocabulary is tiny on purpose: novices cannot articulate taste, so the
 * product asks a four-way question and does the extraction theory itself
 * (§6.7 "sour+weak → under-extracted → grind finer / more temp / more time").
 */

import type { ExtractionDiagnosis, TasteResult, TasteVerdict } from './types.js';

export const TASTE_VERDICTS: readonly TasteVerdict[] = ['bitter', 'sour', 'weak', 'good'];

/**
 * The one true mapping. `unclear` is returned when there is no verdict at all —
 * an unrated repeat is still useful data (logger UX Path A), it just carries no
 * extraction signal, and pretending otherwise would poison the taste model.
 */
export function diagnoseTaste(taste: TasteResult | null | undefined): ExtractionDiagnosis {
  switch (taste?.verdict) {
    case 'bitter':
      return 'over_extracted';
    case 'sour':
    case 'weak':
      return 'under_extracted';
    case 'good':
      return 'balanced';
    default:
      return 'unclear';
  }
}

/**
 * "Rated good" for the purposes of §6.6 ("successful fork") and GC-02
 * (conversion capture, risk #9).
 *
 * Strict by design: only an explicit positive signal counts. A missing verdict,
 * a 3/5, or a bitter brew with a generous star rating are all NOT confirmation,
 * because the entire value of the grind-conversion dataset is that every row in
 * it came from a brew a human said was good.
 */
export function isRatedGood(taste: TasteResult | null | undefined, rating: number | null): boolean {
  if (taste?.verdict === 'good') return true;
  // An explicit non-good verdict overrules a generous star rating: "bitter but
  // 4 stars" is not a confirmed conversion.
  if (taste != null) return false;
  return typeof rating === 'number' && rating >= 4;
}
