'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { catalogApi, type AutocompleteSuggestion } from '../../lib/api';

const DEBOUNCE_MS = 250;
const MIN_QUERY = 2;

/**
 * Entity search over the catalog graph (second_draft §5).
 *
 * Implements the WAI-ARIA 1.2 combobox-with-listbox pattern:
 *  - the input owns role="combobox", aria-expanded, aria-controls and
 *    aria-activedescendant; focus never leaves it
 *  - ArrowDown/ArrowUp move the active option, Enter opens it, Escape closes
 *  - a polite live region announces the result count, so the list is not
 *    something only sighted users know appeared
 *
 * Requests are debounced and the previous one is aborted, so typing fast costs
 * one round trip, not eight.
 */
export function EntitySearch({
  types = ['coffee', 'roaster', 'equipment'],
}: {
  types?: string[];
}) {
  const router = useRouter();
  const listboxId = useId();
  const optionId = (index: number) => `${listboxId}-option-${index}`;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AutocompleteSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [status, setStatus] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  // A fresh array literal from the caller must not restart the effect on every
  // render — compare the types by value, not by reference.
  const typesKey = types.join(',');

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY) {
      setResults([]);
      setOpen(false);
      setStatus('');
      return;
    }

    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      void (async () => {
        try {
          const response = await catalogApi.autocomplete(trimmed, typesKey.split(',').filter(Boolean), {
            signal: controller.signal,
            refreshOn401: false,
          });
          const items = Array.isArray(response?.results) ? response.results : [];
          setResults(items);
          setActiveIndex(-1);
          setOpen(true);
          setStatus(
            items.length === 0
              ? 'No matches yet — try fewer letters.'
              : `${items.length} ${items.length === 1 ? 'match' : 'matches'}. Use the arrow keys to browse.`,
          );
        } catch {
          // Aborts are the normal case while typing, not a failure to report.
          if (controller.signal.aborted) return;
          setResults([]);
          setOpen(false);
          setStatus('Search is having a moment. Browsing below still works.');
        }
      })();
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, typesKey]);

  useEffect(() => () => abortRef.current?.abort(), []);

  function hrefFor(item: AutocompleteSuggestion): string {
    const slug = item.slug ?? item.id;
    if (item.type === 'roaster') return `/discover/roasters/${slug}`;
    if (item.type === 'equipment') return `/discover/equipment/${slug}`;
    return `/discover/${slug}`;
  }

  function choose(index: number) {
    const item = results[index];
    if (!item) return;
    setOpen(false);
    router.push(hrefFor(item));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' && results.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === 'ArrowUp' && results.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (index <= 0 ? results.length - 1 : index - 1));
    } else if (event.key === 'Enter') {
      if (open && activeIndex >= 0) {
        event.preventDefault();
        choose(activeIndex);
      }
    } else if (event.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  const expanded = open && results.length > 0;

  return (
    <div className="bc-combobox">
      <div className="bc-field">
        <label htmlFor={`${listboxId}-input`}>Search coffees, roasters and gear</label>
        <input
          id={`${listboxId}-input`}
          className="bc-input"
          type="text"
          role="combobox"
          autoComplete="off"
          aria-expanded={expanded}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            expanded && activeIndex >= 0 ? optionId(activeIndex) : undefined
          }
          aria-describedby={`${listboxId}-status`}
          placeholder="Yirgacheffe, Kalita, a roaster you like…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
        />
      </div>

      <p className="bc-visually-hidden" id={`${listboxId}-status`} aria-live="polite">
        {status}
      </p>

      <ul
        className="bc-combobox__listbox"
        id={listboxId}
        role="listbox"
        aria-label="Search suggestions"
        hidden={!expanded}
      >
        {results.map((item, index) => (
          <li
            key={`${item.type}:${item.id}`}
            id={optionId(index)}
            className="bc-combobox__option"
            role="option"
            aria-selected={index === activeIndex}
            onMouseDown={(event) => {
              event.preventDefault();
              choose(index);
            }}
            onMouseEnter={() => setActiveIndex(index)}
          >
            <span>
              {item.label}
              {item.subtitle ? <span className="bc-muted"> — {item.subtitle}</span> : null}
            </span>
            <span className="bc-combobox__type">{item.type}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
