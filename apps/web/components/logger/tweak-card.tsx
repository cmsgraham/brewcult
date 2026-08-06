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
import { useLocale, useTranslate } from '../locale-provider';
import { catalogCopy, grindCategoryInline } from '../catalog/copy';

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

/**
 * The stored VALUES, in order. The labels come from the catalogue vocabulary
 * (components/catalog/copy) rather than being spelled again here: the grind
 * categories are already translated there for the equipment pages, and one
 * coffee term with two spellings is how a glossary starts to drift.
 */
const GRIND_CATEGORIES: ReadonlyArray<GrindCategory> = [
  'extra_fine',
  'fine',
  'medium_fine',
  'medium',
  'medium_coarse',
  'coarse',
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
  const t = useTranslate();
  const { locale } = useLocale();
  const grindLabels = catalogCopy(locale).GRIND_CATEGORY_LABEL;
  const grind = grindNumber(draft.grind_setting);
  const ratio = ratioOf(draft.dose_g, draft.water_g);

  function apply(next: BrewDraft) {
    onInteract?.();
    onDraftChange(next);
  }

  return (
    <div className="bc-logger__tweak">
      <div className="bc-logger__row">
        <span className="bc-muted">{draft.brewer_label ?? t('brew.pourOver')}</span>
        <button type="button" className="bc-button bc-button--quiet" onClick={onChangeCoffee}>
          {t('brew.changeCoffee')}
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
              {t('brew.applyIt')}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="bc-logger__fields">
        {grind === null ? (
          <div className="bc-field">
            <label htmlFor="brew-grind-text">{t('brew.grind')}</label>
            <input
              id="brew-grind-text"
              className="bc-input"
              value={draft.grind_setting}
              onChange={(event) => apply(setGrindSetting(draft, event.target.value))}
            />
          </div>
        ) : (
          <Stepper
            label={t('brew.grind')}
            value={grind}
            step={STEP.grind}
            min={LIMIT.grind.min}
            max={LIMIT.grind.max}
            decimals={2}
            display={draft.grind_setting}
            valueText={`${draft.grind_setting}, ${grindCategoryInline(draft.grind_category, locale)}`}
            onChange={(value) => apply(setNumericField(draft, 'grind', value))}
            hint={grindCategoryInline(draft.grind_category, locale)}
          />
        )}

        <Stepper
          label={t('brew.dose')}
          value={draft.dose_g}
          step={STEP.dose_g}
          min={LIMIT.dose_g.min}
          max={LIMIT.dose_g.max}
          decimals={1}
          display={`${draft.dose_g}g`}
          valueText={t('brew.grams', { value: draft.dose_g })}
          onChange={(value) => apply(setNumericField(draft, 'dose_g', value))}
          hint={draft.follow === 'dose' ? t('brew.followsWater') : null}
        />

        <Stepper
          label={t('brew.water')}
          value={draft.water_g}
          step={STEP.water_g}
          min={LIMIT.water_g.min}
          max={LIMIT.water_g.max}
          decimals={0}
          display={`${draft.water_g}g`}
          valueText={t('brew.grams', { value: draft.water_g })}
          onChange={(value) => apply(setNumericField(draft, 'water_g', value))}
          hint={draft.follow === 'water' ? t('brew.followsDose') : null}
        />

        <div className="bc-logger__ratio">
          <span aria-hidden="true">{formatRatio(ratio)}</span>
          <button
            type="button"
            className="bc-logger__lock"
            aria-pressed={draft.follow === 'dose'}
            aria-label={
              draft.follow === 'water'
                ? t('brew.ratioWaterFollows', { ratio: formatRatio(ratio) })
                : t('brew.ratioDoseFollows', { ratio: formatRatio(ratio) })
            }
            onClick={() => apply(toggleRatioLock(draft))}
          >
            <LockIcon />{' '}
            {draft.follow === 'water' ? t('brew.waterFollowsDose') : t('brew.doseFollowsWater')}
          </button>
        </div>

        <Stepper
          label={t('brew.temperature')}
          value={draft.temperature_c}
          step={STEP.temperature_c}
          min={LIMIT.temperature_c.min}
          max={LIMIT.temperature_c.max}
          decimals={0}
          display={`${draft.temperature_c}°`}
          valueText={t('brew.degrees', { value: draft.temperature_c })}
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
        <summary>{t('brew.more')}</summary>
        <div className="bc-field">
          <label htmlFor="brew-grind-category">{t('brew.grindCategory')}</label>
          <span className="bc-field__hint" id="brew-grind-category-hint">
            {t('brew.grindCategoryHint')}
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
              <option key={category} value={category}>
                {grindLabels[category]}
              </option>
            ))}
          </select>
        </div>
      </details>

      <div className="bc-logger__actions">
        <button type="button" className="bc-button bc-logger__primary" onClick={onLog} disabled={busy}>
          {t('brew.logBrew')}
        </button>
        <button type="button" className="bc-button bc-button--quiet" onClick={onCancel}>
          {t('brew.back')}
        </button>
      </div>
    </div>
  );
}
