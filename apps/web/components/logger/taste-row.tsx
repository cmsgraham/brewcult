'use client';

import type { TasteVerdict } from '@brewcult/shared-types';
import { TASTE_OPTIONS } from '../../lib/brewing-client';

export interface TasteRowProps {
  value: TasteVerdict | null;
  onChange: (verdict: TasteVerdict | null) => void;
  /** Heading above the row; the post-log offer words it differently. */
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
export function TasteRow({ value, onChange, legend = 'How was it?', compact = false }: TasteRowProps) {
  return (
    <div
      className={`bc-taste${compact ? ' bc-taste--compact' : ''}`}
      role="group"
      aria-label={legend}
    >
      <span className="bc-taste__legend">{legend}</span>
      <div className="bc-taste__options">
        {TASTE_OPTIONS.map((option) => {
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
