'use client';

import type { BrewPrefill } from '@brewcult/shared-types';
import { useRef } from 'react';
import { formatDuration, formatRatio, ratioOf, type BrewDraft } from '../../lib/brewing-client';

export interface RepeatCardProps {
  draft: BrewDraft;
  basis: BrewPrefill['basis'];
  onRepeat: () => void;
  onTweak: () => void;
  busy?: boolean;
}

const LONG_PRESS_MS = 500;

/** Honest about where the numbers came from — never "your recipe" when it isn't. */
const BASIS_COPY: Record<BrewPrefill['basis'], string> = {
  last_session: 'Same as your last brew',
  official_recipe: "The roaster's recipe for this coffee",
  community_recipe: 'A community recipe for your gear',
  defaults: 'A starting point — change anything',
};

/**
 * Path A — "same as last time" (brew_logger_ux §3, ~40% of logs, ~2 seconds).
 *
 * One primary button, everything it will log visible above it, and a `tweak`
 * affordance for the other 45%. Long-pressing the primary button is the same
 * as tapping tweak, so the thumb never has to travel.
 */
export function RepeatCard({ draft, basis, onRepeat, onTweak, busy = false }: RepeatCardProps) {
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);

  function clearLongPress() {
    if (longPressTimer.current !== null) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  return (
    <div className="bc-logger__repeat">
      <p className="bc-logger__basis">{BASIS_COPY[basis]}</p>

      <dl className="bc-logger__recap">
        <div>
          <dt>Brewer</dt>
          <dd>{draft.brewer_label ?? 'Pour over'}</dd>
        </div>
        <div>
          <dt>Dose → water</dt>
          <dd>
            {draft.dose_g}g → {draft.water_g}g{' '}
            <span className="bc-muted">({formatRatio(ratioOf(draft.dose_g, draft.water_g))})</span>
          </dd>
        </div>
        <div>
          <dt>Temperature</dt>
          <dd>{draft.temperature_c}°C</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>{formatDuration(draft.brew_time_s)}</dd>
        </div>
        <div>
          <dt>Grind</dt>
          <dd>
            {draft.grind_setting || '—'}{' '}
            <span className="bc-muted">({draft.grind_category.replace('_', ' ')})</span>
          </dd>
        </div>
      </dl>

      <div className="bc-logger__actions">
        <button
          type="button"
          className="bc-button bc-logger__primary"
          disabled={busy}
          onClick={() => {
            if (longPressed.current) {
              longPressed.current = false;
              return;
            }
            onRepeat();
          }}
          onPointerDown={() => {
            longPressed.current = false;
            clearLongPress();
            longPressTimer.current = setTimeout(() => {
              longPressed.current = true;
              onTweak();
            }, LONG_PRESS_MS);
          }}
          onPointerUp={clearLongPress}
          onPointerLeave={clearLongPress}
          onPointerCancel={clearLongPress}
        >
          {draft.coffee ? 'Brew this again' : 'Log this brew'}
        </button>
        <button type="button" className="bc-button bc-button--quiet" onClick={onTweak}>
          <span aria-hidden="true">▸ </span>Tweak
        </button>
      </div>
    </div>
  );
}
