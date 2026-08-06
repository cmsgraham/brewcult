'use client';

import type { TasteVerdict } from '@brewcult/shared-types';
import { tasteOptions } from '../../lib/brewing-client';
import { useTranslate } from '../locale-provider';

export interface TasteRowProps {
  value: TasteVerdict | null;
  onChange: (verdict: TasteVerdict | null) => void;
  /**
   * Heading above the row; the post-log offer words it differently. Absent
   * means "How was it?" in the reader's language — which is why this is not a
   * default parameter any more: a default would have to be English.
   */
  legend?: string;
  compact?: boolean;
}

/**
 * Taste in one tap (brew_logger_ux §3, contract §6.7).
 *
 * Four buttons, no scale, no prose. "Good" is a first-class answer rather than
 * a neutral default, and nothing here is required — an unrated brew is still
 * useful data, so this row never blocks the log button.
 *
 * The verdict → extraction diagnosis mapping is deliberately *not* done here:
 * it is server-authoritative (shared-types), so advice and stored diagnoses
 * cannot drift between clients. The hints below are only copy.
 */
export function TasteRow({ value, onChange, legend, compact = false }: TasteRowProps) {
  const t = useTranslate();
  const heading = legend ?? t('brew.howWasIt');
  return (
    <div
      className={`bc-taste${compact ? ' bc-taste--compact' : ''}`}
      role="group"
      aria-label={heading}
    >
      <span className="bc-taste__legend">{heading}</span>
      <div className="bc-taste__options">
        {tasteOptions(t).map((option) => {
          const selected = value === option.verdict;
          return (
            <button
              key={option.verdict}
              type="button"
              className="bc-taste__option"
              aria-pressed={selected}
              aria-label={`${option.label} — ${option.hint}`}
              onClick={() => onChange(selected ? null : option.verdict)}
            >
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
