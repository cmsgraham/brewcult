'use client';

import { useEffect, useRef, useState } from 'react';
import type { FetchLike } from '../../lib/api';
import {
  brewingApi,
  toCoffeeRef,
  type CoffeeRef,
  type ProvisionalCoffee,
} from '../../lib/brewing-client';

const DEBOUNCE_MS = 250;
const MIN_QUERY = 2;

const ROAST_LEVELS = ['Light', 'Medium-light', 'Medium', 'Medium-dark', 'Dark'] as const;

export interface CoffeePickerProps {
  recent: CoffeeRef[];
  onChoose: (coffee: CoffeeRef, options: { provisional?: ProvisionalCoffee }) => void;
  onCancel: () => void;
  fetchImpl?: FetchLike;
  /** Called on the first keystroke/tap so time-to-log counts Path C too. */
  onInteract?: () => void;
}

/**
 * Path C — the new-coffee picker (brew_logger_ux §3).
 *
 * Search-first over the catalog autocomplete (CAT-06) with the user's recent
 * coffees pinned, plus a three-field quick-add that means an uncatalogued bag
 * **never blocks a log**. Bag scan (§3, Wave 4) is deliberately not here.
 *
 * Results are a plain list of buttons rather than an aria-activedescendant
 * combobox: every option is a real tab stop and a 44px tap target, which is
 * what a one-handed user at 6am actually needs. The count is announced in a
 * polite live region so the list is not something only sighted users know about.
 */
export function CoffeePicker({
  recent,
  onChoose,
  onCancel,
  fetchImpl,
  onInteract,
}: CoffeePickerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CoffeeRef[]>([]);
  const [status, setStatus] = useState('');
  const [quickAdd, setQuickAdd] = useState(false);
  const [roaster, setRoaster] = useState('');
  const [name, setName] = useState('');
  const [roastLevel, setRoastLevel] = useState<string>('Medium');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY) {
      setResults([]);
      setStatus('');
      return;
    }

    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      void (async () => {
        try {
          const response = await brewingApi.searchCoffees(trimmed, {
            signal: controller.signal,
            ...(fetchImpl ? { fetchImpl } : {}),
          });
          const items = Array.isArray(response?.results) ? response.results.map(toCoffeeRef) : [];
          setResults(items);
          setStatus(
            items.length === 0
              ? 'No match yet — you can add it in three fields below.'
              : `${items.length} ${items.length === 1 ? 'match' : 'matches'}.`,
          );
          if (items.length === 0) setQuickAdd(true);
        } catch {
          if (controller.signal.aborted) return;
          setResults([]);
          // Offline is the expected case in a kitchen; say so without alarm.
          setStatus('Search needs a connection. Add it in three fields below and log anyway.');
          setQuickAdd(true);
        }
      })();
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, fetchImpl]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const canQuickAdd = name.trim().length > 0;

  return (
    <div className="bc-logger__picker bc-stack" aria-label="Choose a coffee">
      <div className="bc-field">
        <label htmlFor="brew-coffee-search">Which coffee?</label>
        <input
          id="brew-coffee-search"
          className="bc-input"
          type="search"
          autoComplete="off"
          placeholder="Start typing — “chelb” finds it"
          value={query}
          onChange={(event) => {
            onInteract?.();
            setQuery(event.target.value);
          }}
        />
      </div>

      <p className="bc-visually-hidden" aria-live="polite">
        {status}
      </p>

      {query.trim().length < MIN_QUERY && recent.length > 0 ? (
        <div>
          <h3 className="bc-logger__subhead">Recent bags</h3>
          <ul className="bc-logger__options">
            {recent.map((coffee) => (
              <li key={coffee.id ?? coffee.label}>
                <button
                  type="button"
                  className="bc-logger__option"
                  onClick={() => onChoose(coffee, {})}
                >
                  <span>{coffee.label}</span>
                  {coffee.subtitle ? <span className="bc-muted">{coffee.subtitle}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {results.length > 0 ? (
        <ul className="bc-logger__options">
          {results.map((coffee) => (
            <li key={coffee.id ?? coffee.label}>
              <button
                type="button"
                className="bc-logger__option"
                onClick={() => onChoose(coffee, {})}
              >
                <span>{coffee.label}</span>
                {coffee.subtitle ? <span className="bc-muted">{coffee.subtitle}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {quickAdd ? (
        <div className="bc-panel bc-stack">
          <h3 className="bc-logger__subhead">Add it in three fields</h3>
          <div className="bc-field">
            <label htmlFor="brew-quick-roaster">Roaster</label>
            <input
              id="brew-quick-roaster"
              className="bc-input"
              value={roaster}
              onChange={(event) => setRoaster(event.target.value)}
            />
          </div>
          <div className="bc-field">
            <label htmlFor="brew-quick-name">Coffee name</label>
            <input
              id="brew-quick-name"
              className="bc-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="bc-field">
            <label htmlFor="brew-quick-roast">Roast level</label>
            <select
              id="brew-quick-roast"
              className="bc-input"
              value={roastLevel}
              onChange={(event) => setRoastLevel(event.target.value)}
            >
              {ROAST_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="bc-button"
            disabled={!canQuickAdd}
            onClick={() =>
              onChoose(
                {
                  id: null,
                  label: [roaster.trim(), name.trim()].filter(Boolean).join(' · ') || name.trim(),
                  subtitle: roastLevel,
                },
                {
                  provisional: {
                    roaster: roaster.trim(),
                    name: name.trim(),
                    roast_level: roastLevel,
                  },
                },
              )
            }
          >
            Use this coffee
          </button>
          <p className="bc-muted" style={{ marginBottom: 0, fontSize: '0.88rem' }}>
            We&apos;ll match it to the catalogue later. Your brews stay attached to it either way.
          </p>
        </div>
      ) : (
        <button
          type="button"
          className="bc-button bc-button--quiet"
          onClick={() => setQuickAdd(true)}
        >
          Not in the list? Add it in three fields
        </button>
      )}

      <button type="button" className="bc-button bc-button--quiet" onClick={onCancel}>
        Back to brewing
      </button>
    </div>
  );
}
