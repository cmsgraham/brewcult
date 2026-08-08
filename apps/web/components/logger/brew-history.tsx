'use client';

import { useEffect, useRef, useState } from 'react';
import type { FetchLike } from '../../lib/api';
import { isApiError } from '../../lib/api';
import type { TasteVerdict } from '@brewcult/shared-types';
import {
  brewingApi,
  formatDuration,
  formatRatio,
  isFilterParams,
  normalizeBrewList,
  ratioOf,
  tasteOptions,
  type LabelledBrewSession,
} from '../../lib/brewing-client';
import type { Translator } from '../../lib/i18n';
import { createBrewEngine, type BrewEngine } from '../../lib/offline/engine';
import { LocaleLink as Link } from '../locale-link';
import { useLocale, useTranslate } from '../locale-provider';

const PAGE_SIZE = 20;

/**
 * Your brews, most recent first (§8 — the log is the point of the logger).
 *
 * ── WHY THIS MERGES TWO SOURCES ─────────────────────────────────────────────
 * A brew exists on the device the moment it is logged and on the server only
 * once the queue has drained (EF §2.2). Showing the server list alone would
 * mean a brew logged in a kitchen with no signal is simply missing from the
 * history — the exact moment somebody would go looking to check it saved. So
 * unsynced local records are merged in and marked, rather than waited for.
 *
 * Server rows win on id collision: once a brew has synced, the server holds the
 * authoritative copy (including any edit made from another device), and the
 * local record is a stale duplicate rather than a second brew.
 *
 * ── WHY IT IS A CLIENT ISLAND ───────────────────────────────────────────────
 * Two reasons, either sufficient: the local half lives in IndexedDB, and the
 * server half is per-user private data that must never land in a shared cache.
 */
type Row = {
  key: string;
  brewedAt: string;
  coffee: string | null;
  roaster: string | null;
  brewer: string | null;
  dose: number | null;
  water: number | null;
  temperature: number | null;
  timeSeconds: number | null;
  grind: string | null;
  rating: number | null;
  /** How it actually tasted. The whole point of logging, and it was missing. */
  verdict: TasteVerdict | null;
  pending: boolean;
};

type State =
  | { status: 'loading' }
  | { status: 'ready'; rows: Row[]; cursor: string | null; loadingMore: boolean }
  | { status: 'signedOut' }
  | { status: 'error'; rows: Row[] };

function rowFromSession(session: LabelledBrewSession): Row {
  const params = session.params;
  const filter = isFilterParams(params) ? params : null;
  return {
    key: session.id,
    brewedAt: session.brewed_at,
    coffee: session.coffee_label,
    roaster: session.roaster_label,
    brewer: session.brewer_label,
    dose: filter?.dose_g ?? null,
    water: filter?.water_g ?? null,
    temperature: filter?.temperature_c ?? null,
    timeSeconds: filter?.brew_time_s ?? null,
    grind: session.grind?.setting ?? null,
    rating: session.rating ?? null,
    verdict: session.taste?.verdict ?? null,
    pending: false,
  };
}

export function BrewHistory({
  fetchImpl,
  engine: providedEngine,
}: {
  fetchImpl?: FetchLike;
  engine?: BrewEngine;
}) {
  const t = useTranslate();
  const { locale } = useLocale();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [engine] = useState<BrewEngine>(
    () => providedEngine ?? createBrewEngine({ ...(fetchImpl ? { fetchImpl } : {}) }),
  );
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const alive = useRef(true);

  /**
   * Removes the row, then tells the engine.
   *
   * The list updates first because the engine's own delete is local-first: the
   * brew is gone from this device before any request is made, and the DELETE is
   * queued exactly like a log is. Waiting on the network to redraw would make
   * deletion feel slower than creation, which is backwards.
   */
  async function remove(id: string): Promise<void> {
    setDeleting(id);
    try {
      await engine.deleteBrew(id);
      if (!alive.current) return;
      setState((current) =>
        current.status === 'ready' || current.status === 'error'
          ? { ...current, rows: current.rows.filter((row) => row.key !== id) }
          : current,
      );
      setConfirming(null);
    } finally {
      if (alive.current) setDeleting(null);
    }
  }

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    void (async () => {
      // The device first: it answers instantly and it is the only source that
      // has the brew somebody logged thirty seconds ago on a bad connection.
      const local = await engine.localSessions();
      const pending: Row[] = local
        .filter((record) => !record.synced)
        .map((record) => {
          const params = record.session.params;
          const filter = isFilterParams(params) ? params : null;
          return {
            key: record.session.id,
            brewedAt: record.session.brewed_at,
            coffee: record.coffee_label,
            roaster: null,
            brewer: record.brewer_label,
            dose: filter?.dose_g ?? null,
            water: filter?.water_g ?? null,
            temperature: filter?.temperature_c ?? null,
            timeSeconds: filter?.brew_time_s ?? null,
            grind: record.session.grind?.setting ?? null,
            rating: record.session.rating ?? null,
            verdict: record.session.taste?.verdict ?? null,
            pending: true,
          };
        });

      try {
        const raw = await brewingApi.list(
          { limit: PAGE_SIZE },
          { ...(fetchImpl ? { fetchImpl } : {}) },
        );
        const { items, nextCursor } = normalizeBrewList(raw);
        if (!alive.current) return;
        setState({
          status: 'ready',
          rows: merge(pending, items.map(rowFromSession)),
          cursor: nextCursor,
          loadingMore: false,
        });
      } catch (failure) {
        if (!alive.current) return;
        // 401 is not an error to apologise for — it means "sign in", and the
        // brews are still on this device either way.
        if (isApiError(failure) && failure.status === 401) {
          setState(pending.length > 0 ? { status: 'error', rows: pending } : { status: 'signedOut' });
          return;
        }
        setState({ status: 'error', rows: pending });
      }
    })();
  }, [engine, fetchImpl]);

  async function loadMore(): Promise<void> {
    if (state.status !== 'ready' || !state.cursor || state.loadingMore) return;
    setState({ ...state, loadingMore: true });
    try {
      const raw = await brewingApi.list(
        { cursor: state.cursor, limit: PAGE_SIZE },
        { ...(fetchImpl ? { fetchImpl } : {}) },
      );
      const { items, nextCursor } = normalizeBrewList(raw);
      if (!alive.current) return;
      setState((current) =>
        current.status === 'ready'
          ? {
              status: 'ready',
              rows: merge(current.rows, items.map(rowFromSession)),
              cursor: nextCursor,
              loadingMore: false,
            }
          : current,
      );
    } catch {
      if (!alive.current) return;
      setState((current) =>
        current.status === 'ready' ? { ...current, loadingMore: false } : current,
      );
    }
  }

  if (state.status === 'loading') {
    return <p className="bc-muted">{t('history.loading')}</p>;
  }

  if (state.status === 'signedOut') {
    return (
      <p className="bc-muted">
        {t('history.signedOutOne')}{' '}
        <Link href="/login">{t('history.signedOutLink')}</Link>
        {t('history.signedOutTwo')}
      </p>
    );
  }

  if (state.rows.length === 0) {
    return (
      <div className="bc-stack">
        <p className="bc-muted">
          {state.status === 'error' ? t('history.loadError') : t('history.empty')}
        </p>
        <p>
          <Link className="bc-button" href="/brew">
            {t('history.logFirst')}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="bc-stack">
      {state.status === 'error' ? <p className="bc-muted">{t('history.partial')}</p> : null}

      <ol className="bc-history">
        {state.rows.map((row) => (
          <li key={row.key} className="bc-history__item">
            <div className="bc-history__head">
              <span className="bc-history__coffee">
                {row.coffee ? (
                  row.coffee
                ) : (
                  <span className="bc-muted">{t('history.unnamedCoffee')}</span>
                )}
              </span>
              <time dateTime={row.brewedAt} className="bc-muted">
                {formatWhen(row.brewedAt, locale)}
              </time>
            </div>

            {row.roaster || row.brewer ? (
              <p className="bc-muted bc-history__sub">
                {[row.roaster, row.brewer].filter(Boolean).join(' · ')}
              </p>
            ) : null}

            <p className="bc-history__specs">{specLine(row, t)}</p>

            {/* The RESULT. A log that shows only what you did, and never how it
                came out, is a recipe card — the taste is the reason to keep
                one. Absent when it was never rated, which is a real state: an
                unrated repeat is still useful data (§8). */}
            {row.verdict || row.rating !== null ? (
              <p className="bc-history__result">
                {row.verdict ? (
                  <span className={`bc-history__verdict bc-history__verdict--${row.verdict}`}>
                    {verdictLabel(row.verdict, t)}
                  </span>
                ) : null}
                {row.rating !== null ? (
                  <span className="bc-muted">{t('history.rating', { rating: row.rating })}</span>
                ) : null}
              </p>
            ) : (
              <p className="bc-muted bc-history__result">{t('history.unrated')}</p>
            )}

            {row.pending ? (
              <p className="bc-muted bc-history__pending">{t('history.pending')}</p>
            ) : null}

            <p className="bc-history__actions">
              {confirming === row.key ? (
                <>
                  <span className="bc-muted">{t('history.deleteConfirm')}</span>
                  <button
                    type="button"
                    className="bc-button bc-button--quiet"
                    onClick={() => void remove(row.key)}
                    disabled={deleting === row.key}
                  >
                    {deleting === row.key ? t('history.deleting') : t('history.deleteYes')}
                  </button>
                  <button
                    type="button"
                    className="bc-button bc-button--quiet"
                    onClick={() => setConfirming(null)}
                    disabled={deleting === row.key}
                  >
                    {t('common.cancel')}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="bc-button bc-button--quiet"
                  onClick={() => setConfirming(row.key)}
                >
                  {t('history.delete')}
                </button>
              )}
            </p>
          </li>
        ))}
      </ol>

      {state.status === 'ready' && state.cursor ? (
        <p>
          <button
            type="button"
            className="bc-button bc-button--quiet"
            onClick={() => void loadMore()}
            disabled={state.loadingMore}
          >
            {state.loadingMore ? t('history.loadingMore') : t('history.more')}
          </button>
        </p>
      ) : null}
    </div>
  );
}

/**
 * Local pending rows first, then server rows, with the server winning on id.
 *
 * Sorted newest-first afterwards rather than concatenated, because a brew
 * logged offline yesterday should not sit above one synced today just because
 * it came from a different source.
 */
export function merge(pending: Row[], server: Row[]): Row[] {
  const seen = new Set(server.map((row) => row.key));
  const rows = [...server, ...pending.filter((row) => !seen.has(row.key))];
  return rows.sort((a, b) => (a.brewedAt < b.brewedAt ? 1 : a.brewedAt > b.brewedAt ? -1 : 0));
}

/** The verdict in the reader's language, from the same table the logger uses. */
function verdictLabel(verdict: TasteVerdict, t: Translator): string {
  return tasteOptions(t).find((option) => option.verdict === verdict)?.label ?? verdict;
}

/** The numbers, in the order somebody reads them back. Missing ones are skipped. */
function specLine(row: Row, t: Translator): string {
  const parts: string[] = [];
  if (row.dose !== null && row.water !== null) {
    parts.push(`${row.dose}g → ${row.water}g (${formatRatio(ratioOf(row.dose, row.water))})`);
  } else if (row.dose !== null) {
    parts.push(`${row.dose}g`);
  }
  if (row.grind !== null) parts.push(`${t('brew.grind')} ${row.grind}`);
  if (row.temperature !== null) parts.push(`${row.temperature}°C`);
  if (row.timeSeconds) parts.push(formatDuration(row.timeSeconds));
  return parts.join(' · ');
}

/**
 * A date somebody can place without doing arithmetic.
 *
 * `Intl` already knows both languages; the alternative is a table of month
 * names in the catalogue that would drift from the locale the page is in.
 */
function formatWhen(iso: string, locale: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '';
  return new Intl.DateTimeFormat(locale === 'es' ? 'es-CR' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(when);
}
