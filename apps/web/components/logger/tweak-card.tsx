'use client';

import type { GrindCategory } from '@brewcult/shared-types';
import type { ReactNode } from 'react';
import {
  formatRatio,
  grindNumber,
  LIMIT,
  ratioOf,
  setGrindCategory,
  setGrindSetting,
  setNumericField,
  setVerdict,
  STEP,
  toggleRatioLock,
  type BrewDraft,
  type BrewSuggestion,
} from '../../lib/brewing-client';
import { BrewTimer } from './brew-timer';
import { Stepper } from './stepper';
import { TasteRow } from './taste-row';
import { LockIcon } from '../ui/icon';

export interface TweakCardProps {
  draft: BrewDraft;
  onDraftChange: (next: BrewDraft) => void;
  onChangeCoffee: () => void;
  onLog: () => void;
  onCancel: () => void;
  onInteract?: () => void;
  now?: () => number;
  busy?: boolean;
  /** Yesterday's "try 0.5 coarser?" suggestion, offered as one tap. */
  suggestion?: BrewSuggestion | null;
  onApplySuggestion?: () => void;
  /**
   * Optional photo affordance (components/media). A slot rather than a direct
   * import so this card keeps knowing nothing about uploads — and so the
   * photo's lifecycle stays where it belongs: outside the log.
   *
   * §4 is emphatic that a photo never blocks a log, so whatever lands here is
   * rendered *after* the numbers and *before* the primary action, and "Log
   * brew" never consults it.
   */
  photoSlot?: ReactNode;
}

const GRIND_CATEGORIES: ReadonlyArray<{ value: GrindCategory; label: string }> = [
  { value: 'extra_fine', label: 'Extra fine' },
  { value: 'fine', label: 'Fine' },
  { value: 'medium_fine', label: 'Medium fine' },
  { value: 'medium', label: 'Medium' },
  { value: 'medium_coarse', label: 'Medium coarse' },
  { value: 'coarse', label: 'Coarse' },
];

/**
 * Path B — "tweak one thing" (brew_logger_ux §3, ~45% of logs, 8–12 seconds).
 *
 * Same card as Path A, every value prefilled and inline-editable. No modal, no
 * page change. Steppers rather than keyboards; ratio derived, never entered;
 * taste in one tap; the timer optional. The fields §4 deliberately cuts
 * (water chemistry, pour schedule, TDS, prose) are not here at all.
 *
 * The one addition is `photoSlot` — §4 keeps a photo optional and off the
 * critical path, so it arrives as a closed disclosure below the numbers and the
 * primary action never waits for it.
 */
export function TweakCard({
  draft,
  onDraftChange,
  onChangeCoffee,
  onLog,
  onCancel,
  onInteract,
  now,
  busy = false,
  suggestion = null,
  onApplySuggestion,
  photoSlot,
}: TweakCardProps) {
  const grind = grindNumber(draft.grind_setting);
  const ratio = ratioOf(draft.dose_g, draft.water_g);

  function apply(next: BrewDraft) {
    onInteract?.();
    onDraftChange(next);
  }

  return (
    <div className="bc-logger__tweak">
      <div className="bc-logger__row">
        <span className="bc-muted">{draft.brewer_label ?? 'Pour over'}</span>
        <button type="button" className="bc-button bc-button--quiet" onClick={onChangeCoffee}>
          Change coffee
        </button>
      </div>

      {suggestion ? (
        <div className="bc-logger__suggestion">
          <p>{suggestion.text}</p>
          {onApplySuggestion ? (
            <button
              type="button"
              className="bc-button bc-button--quiet"
              onClick={() => {
                onInteract?.();
                onApplySuggestion();
              }}
            >
              Apply it
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="bc-logger__fields">
        {grind === null ? (
          <div className="bc-field">
            <label htmlFor="brew-grind-text">Grind</label>
            <input
              id="brew-grind-text"
              className="bc-input"
              value={draft.grind_setting}
              onChange={(event) => apply(setGrindSetting(draft, event.target.value))}
            />
          </div>
        ) : (
          <Stepper
            label="Grind"
            value={grind}
            step={STEP.grind}
            min={LIMIT.grind.min}
            max={LIMIT.grind.max}
            decimals={2}
            display={draft.grind_setting}
            valueText={`${draft.grind_setting}, ${draft.grind_category.replace('_', ' ')}`}
            onChange={(value) => apply(setNumericField(draft, 'grind', value))}
            hint={draft.grind_category.replace('_', ' ')}
          />
        )}

        <Stepper
          label="Dose"
          value={draft.dose_g}
          step={STEP.dose_g}
          min={LIMIT.dose_g.min}
          max={LIMIT.dose_g.max}
          decimals={1}
          display={`${draft.dose_g}g`}
          valueText={`${draft.dose_g} grams`}
          onChange={(value) => apply(setNumericField(draft, 'dose_g', value))}
          hint={draft.follow === 'dose' ? 'follows water' : null}
        />

        <Stepper
          label="Water"
          value={draft.water_g}
          step={STEP.water_g}
          min={LIMIT.water_g.min}
          max={LIMIT.water_g.max}
          decimals={0}
          display={`${draft.water_g}g`}
          valueText={`${draft.water_g} grams`}
          onChange={(value) => apply(setNumericField(draft, 'water_g', value))}
          hint={draft.follow === 'water' ? 'follows dose' : null}
        />

        <div className="bc-logger__ratio">
          <span aria-hidden="true">{formatRatio(ratio)}</span>
          <button
            type="button"
            className="bc-logger__lock"
            aria-pressed={draft.follow === 'dose'}
            aria-label={
              draft.follow === 'water'
                ? `Ratio ${formatRatio(ratio)}. Water follows dose. Activate so dose follows water instead.`
                : `Ratio ${formatRatio(ratio)}. Dose follows water. Activate so water follows dose instead.`
            }
            onClick={() => apply(toggleRatioLock(draft))}
          >
            <LockIcon />{' '}
            {draft.follow === 'water' ? 'water follows dose' : 'dose follows water'}
          </button>
        </div>

        <Stepper
          label="Temperature"
          value={draft.temperature_c}
          step={STEP.temperature_c}
          min={LIMIT.temperature_c.min}
          max={LIMIT.temperature_c.max}
          decimals={0}
          display={`${draft.temperature_c}°`}
          valueText={`${draft.temperature_c} degrees celsius`}
          onChange={(value) => apply(setNumericField(draft, 'temperature_c', value))}
        />

        <BrewTimer
          seconds={draft.brew_time_s}
          startedAt={draft.timer_started_at}
          {...(now ? { now } : {})}
          onSecondsChange={(seconds) => apply(setNumericField(draft, 'brew_time_s', seconds))}
          onStartedAtChange={(startedAt) => apply({ ...draft, timer_started_at: startedAt })}
        />
      </div>

      <TasteRow
        value={draft.verdict}
        onChange={(verdict) => apply(setVerdict(draft, verdict))}
      />

      {photoSlot ?? null}

      <details className="bc-logger__more">
        <summary>More</summary>
        <div className="bc-field">
          <label htmlFor="brew-grind-category">Grind category</label>
          <span className="bc-field__hint" id="brew-grind-category-hint">
            The only grind value that survives a change of grinder.
          </span>
          <select
            id="brew-grind-category"
            className="bc-input"
            aria-describedby="brew-grind-category-hint"
            value={draft.grind_category}
            onChange={(event) =>
              apply(setGrindCategory(draft, event.target.value as GrindCategory))
            }
          >
            {GRIND_CATEGORIES.map((category) => (
              <option key={category.value} value={category.value}>
                {category.label}
              </option>
            ))}
          </select>
        </div>
      </details>

      <div className="bc-logger__actions">
        <button type="button" className="bc-button bc-logger__primary" onClick={onLog} disabled={busy}>
          Log brew
        </button>
        <button type="button" className="bc-button bc-button--quiet" onClick={onCancel}>
          Back
        </button>
      </div>
    </div>
  );
}
