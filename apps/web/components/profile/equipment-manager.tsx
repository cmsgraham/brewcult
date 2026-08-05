'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { isApiError } from '../../lib/api';
import {
  CATEGORY_LABEL,
  addMyEquipment,
  equipmentTitle,
  fetchMyEquipment,
  makePrimaryEquipment,
  removeMyEquipment,
  searchEquipment,
  type EquipmentSuggestion,
  type OwnedEquipment,
} from '../../lib/equipment-client';
import { Alert } from '../ui/alert';

/**
 * "Your equipment", for real.
 *
 * This replaced a card reading "The equipment picker arrives with the brew
 * logger — nothing to do for now." The logger shipped, so that copy promised
 * something against a milestone that had already passed, and there was no way
 * to add anything at all.
 *
 * Search rather than a dropdown: the catalogue is ~100 models and only grows,
 * and people know their gear by name ("niche", "v60") long before they would
 * find it by scrolling a grouped <select>.
 *
 * Kept deliberately small otherwise — no purchase dates, prices, condition or
 * photos. Each is a field somebody has to maintain and none changes a brewing
 * suggestion (second_draft §10: ask for what you will use).
 */
export function EquipmentManager() {
  const [owned, setOwned] = useState<OwnedEquipment[] | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<EquipmentSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const listId = 'equipment-search-results';

  useEffect(() => {
    let cancelled = false;
    fetchMyEquipment()
      .then((mine) => {
        if (!cancelled) setOwned(mine);
      })
      .catch(() => {
        if (!cancelled) {
          setOwned([]);
          setError('We could not load your equipment. Reload to try again.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced so typing "comandante" is one request at the end rather than ten
  // on the way there. 250ms is below the threshold where a search box starts to
  // feel like it is ignoring you.
  useEffect(() => {
    const q = query.trim();
    if (q === '') {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const timer = setTimeout(() => {
      searchEquipment(q)
        .then((items) => {
          if (!cancelled) setResults(items);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const ownedModelIds = useMemo(
    () => new Set((owned ?? []).map((item) => item.equipment_model_id)),
    [owned],
  );

  const run = useCallback(async (action: () => Promise<OwnedEquipment[]>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setOwned(await action());
    } catch (failure) {
      setError(
        isApiError(failure) ? failure.userMessage : 'That did not save. Try again in a moment.',
      );
    } finally {
      setBusy(false);
    }
  }, []);

  if (owned === null) {
    return (
      <p className="bc-muted" role="status">
        {error ?? 'Loading your equipment…'}
      </p>
    );
  }

  return (
    <div className="bc-stack">
      {error ? <Alert tone="error">{error}</Alert> : null}

      {owned.length === 0 ? (
        <p className="bc-muted">
          Nothing here yet. Add the grinder and brewer you use most — that is enough for
          suggestions to talk in your numbers.
        </p>
      ) : (
        <ul className="bc-kit">
          {owned.map((item) => (
            <li key={item.id} className="bc-kit__row">
              <div className="bc-kit__text">
                <span className="bc-kit__name">
                  {equipmentTitle(item)}
                  {item.is_primary ? <span className="bc-kit__badge">Default</span> : null}
                </span>
                <span className="bc-muted bc-kit__meta">
                  {CATEGORY_LABEL[item.category].replace(/s$/, '')}
                  {item.grind_scale_type ? ` · ${item.grind_scale_type} scale` : ''}
                </span>
              </div>
              <div className="bc-kit__actions">
                {item.is_primary ? null : (
                  <button
                    type="button"
                    className="bc-button bc-button--quiet bc-kit__button"
                    disabled={busy}
                    onClick={() => void run(() => makePrimaryEquipment(item.id))}
                  >
                    Make default
                  </button>
                )}
                <button
                  type="button"
                  className="bc-button bc-button--quiet bc-kit__button"
                  disabled={busy}
                  onClick={() => void run(() => removeMyEquipment(item.id))}
                >
                  Remove<span className="bc-visually-hidden"> {equipmentTitle(item)}</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="bc-kit__search">
        <label className="bc-kit__label" htmlFor="equipment-search">
          Add equipment
        </label>
        <input
          id="equipment-search"
          className="bc-input"
          type="search"
          autoComplete="off"
          placeholder="Search grinders, brewers, kettles, scales…"
          value={query}
          disabled={busy}
          onChange={(event) => setQuery(event.target.value)}
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
        />

        {/* Every state gets a sentence. A search box that goes quiet when it
            finds nothing reads as broken rather than as empty. */}
        <p className="bc-muted bc-kit__status" role="status">
          {query.trim() === ''
            ? 'Type a brand or model — “niche”, “v60”, “stagg”.'
            : searching
              ? 'Searching…'
              : results.length === 0
                ? 'Nothing matched. If your gear is missing we will add it — the catalogue is still growing.'
                : `${results.length} match${results.length === 1 ? '' : 'es'}`}
        </p>

        {results.length > 0 ? (
          <ul className="bc-kit__results" id={listId}>
            {results.map((item) => {
              const already = ownedModelIds.has(item.id);
              return (
                <li key={item.id} className="bc-kit__result">
                  <span className="bc-kit__text">
                    <span className="bc-kit__name">{item.label}</span>
                    {item.sublabel ? (
                      <span className="bc-muted bc-kit__meta">{item.sublabel}</span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    className="bc-button bc-kit__button"
                    disabled={busy || already}
                    onClick={() =>
                      void run(async () => {
                        const next = await addMyEquipment({ equipment_model_id: item.id });
                        setQuery('');
                        setResults([]);
                        return next;
                      })
                    }
                  >
                    {already ? 'Added' : 'Add'}
                    <span className="bc-visually-hidden"> {item.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
