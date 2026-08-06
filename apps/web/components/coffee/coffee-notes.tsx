'use client';

import { useEffect, useState } from 'react';
import { hasSessionHint, isApiError } from '../../lib/api';
import {
  SCA_FORM,
  deleteMyReview,
  fetchCoffeeReviews,
  saveMyReview,
  toggleHelpful,
  type CoffeeRatingSummary,
  type CoffeeReview,
  type SaveReviewInput,
  type ScaField,
} from '../../lib/coffee-reviews-client';
import { Alert } from '../ui/alert';
import { useLocale, useTranslate } from '../locale-provider';
import { localePath } from '../../lib/i18n';

/**
 * What people thought of a coffee.
 *
 * ── WHY A CLIENT ISLAND ON AN OTHERWISE STATIC PAGE ─────────────────────────
 * The coffee page is the SEO surface and renders with no JavaScript at all.
 * These notes are per-viewer (your own first, your votes marked) and change
 * between two people looking at the same URL, so they cannot be part of a
 * revalidated server render without either leaking one person's state into
 * another's cache or throwing the cache away for everybody.
 *
 * The cost is that notes are invisible to a crawler. That is the right trade
 * here: the page's ranking content is the coffee, and a note is a reason to
 * come back rather than a reason to be found.
 *
 * ── ONE NOTE PER PERSON ─────────────────────────────────────────────────────
 * Enforced by the database (0016), which means this form is an EDITOR whenever
 * you already have one. There is no second "add another" path to get wrong.
 */
/**
 * 6.00 to 10.00 in quarter points — the SCA scale, not a five-star one.
 *
 * The floor is 6 because the form grades SPECIALTY coffee: below that a coffee
 * has a defect, and defects are counted as taints and faults rather than by
 * scoring an attribute at 3. Somebody who hated a bag says 6 and explains why
 * in the note, which is more use than one star.
 */
const STEPS: number[] = Array.from({ length: 17 }, (_, i) => 6 + i * 0.25);

/**
 * The word the form prints beside each whole number.
 *
 * Translated, unlike the attribute NAMES, which the trade uses in English here
 * ("el body", "el clean cup"). A score's meaning has to be readable; a term of
 * art is clearer left as the term of art.
 */
const anchorKeyFor = (value: number): 'good' | 'veryGood' | 'excellent' | 'outstanding' | 'exceptional' =>
  value >= 10 ? 'exceptional' : value >= 9 ? 'outstanding' : value >= 8 ? 'excellent' : value >= 7 ? 'veryGood' : 'good';

const EMPTY_SUMMARY: CoffeeRatingSummary = {
  average_overall: null,
  average_cupping: null,
  cupped_count: 0,
  count: 0,
};

export function CoffeeNotes({ slug }: { slug: string }) {
  const t = useTranslate();
  const { locale } = useLocale();
  /**
   * Worked out here rather than passed in. The page above is `revalidate`d and
   * shared between everybody; reading a cookie there would make it per-request
   * to decide one sentence. The hint cookie grants nothing — it only picks
   * between "rate this" and "sign in to rate this", and the API refuses
   * anything that matters regardless of what this says.
   */
  const [signedIn, setSignedIn] = useState(false);
  const [items, setItems] = useState<CoffeeReview[]>([]);
  const [summary, setSummary] = useState<CoffeeRatingSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [overall, setOverall] = useState(0);
  const [body, setBody] = useState('');
  const [method, setMethod] = useState('');
  /** The other nine. Hidden until asked for — most people are not cupping. */
  const [cupping, setCupping] = useState(false);
  const [attributes, setAttributes] = useState<Partial<Record<ScaField, number>>>({});
  const [taints, setTaints] = useState(0);
  const [faults, setFaults] = useState(0);
  const [busy, setBusy] = useState(false);

  const mine = items.find((item) => item.is_mine) ?? null;

  useEffect(() => {
    setSignedIn(hasSessionHint());
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchCoffeeReviews(slug)
      .then((result) => {
        if (cancelled) return;
        setItems(result.items);
        setSummary(result.summary);
      })
      .catch(() => undefined) // an empty list reads the same as a failed one
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  function startEditing(): void {
    setOverall(mine?.overall ?? 0);
    setBody(mine?.body ?? '');
    setMethod(mine?.brew_method ?? '');
    setTaints(mine?.taint_cups ?? 0);
    setFaults(mine?.fault_cups ?? 0);
    const existing: Partial<Record<ScaField, number>> = {};
    for (const field of SCA_FORM) {
      const value = mine?.[field.key];
      if (typeof value === 'number') existing[field.key] = value;
    }
    setAttributes(existing);
    setCupping(Object.keys(existing).length > 0);
    setEditing(true);
    setError(null);
  }

  async function save(): Promise<void> {
    if (overall === 0) return;
    setBusy(true);
    setError(null);
    try {
      const payload: SaveReviewInput = {
        overall,
        ...(body.trim() ? { body: body.trim() } : {}),
        ...(method.trim() ? { brew_method: method.trim() } : {}),
        // Only sent when the full form is open. A half-filled form has no
        // total, and sending stray attributes would imply one.
        ...(cupping
          ? { ...attributes, taint_cups: taints, fault_cups: faults, scored_at_table: true }
          : {}),
      };
      const result = await saveMyReview(slug, payload);
      setItems(result.items);
      setSummary(result.summary);
      setEditing(false);
    } catch (failure) {
      setError(
        isApiError(failure) ? failure.userMessage : t('common.tryAgain'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    setBusy(true);
    try {
      const result = await deleteMyReview(slug);
      setItems(result.items);
      setSummary(result.summary);
      setEditing(false);
    } catch (failure) {
      setError(isApiError(failure) ? failure.userMessage : t('common.tryAgain'));
    } finally {
      setBusy(false);
    }
  }

  async function vote(review: CoffeeReview): Promise<void> {
    try {
      const result = await toggleHelpful(slug, review.id);
      setItems(result.items);
      setSummary(result.summary);
    } catch (failure) {
      setError(isApiError(failure) ? failure.userMessage : t('common.tryAgain'));
    }
  }

  return (
    <section aria-labelledby="notes-heading" className="bc-stack">
      <h2 id="notes-heading">
        {t('notes.heading')}
        {summary.count > 0 ? (
          <span className="bc-muted" style={{ fontSize: '1rem', fontWeight: 400 }}>
            {' '}
            ·{' '}
            {summary.count === 1
              ? t('notes.summaryOne', { score: summary.average_overall ?? 0 })
              : t('notes.summary', {
                  score: summary.average_overall ?? 0,
                  count: summary.count,
                })}
            {summary.average_cupping !== null
              ? ` · ${t('notes.cupping', {
                  score: summary.average_cupping,
                  count: summary.cupped_count,
                })}`
              : ''}
          </span>
        ) : null}
      </h2>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {!signedIn ? (
        <p className="bc-muted">
          <a
            href={`${localePath('/login', locale)}?next=${encodeURIComponent(
              localePath(`/coffee/${slug}`, locale),
            )}`}
          >
            {t('common.signIn')}
          </a>{' '}
          {t('notes.signedOutPrompt')}
        </p>
      ) : editing ? (
        <div className="bc-panel bc-stack">
          <span className="bc-field">
            <label className="bc-kit__label" htmlFor="sca-overall">
              {t('notes.overallLabel')}
            </label>
            <select
              id="sca-overall"
              className="bc-input"
              value={overall || ''}
              disabled={busy}
              onChange={(event) => setOverall(Number(event.target.value))}
            >
              <option value="">{t('notes.pickScore')}</option>
              {STEPS.map((value) => (
                <option key={value} value={value}>
                  {value.toFixed(2)} — {t(`scale.${anchorKeyFor(value)}`)}
                </option>
              ))}
            </select>
            {/* The scale is not ours, and saying so is the point of using it. */}
            <span className="bc-muted" style={{ fontSize: '0.85rem' }}>
              {t('notes.scaleHint')}{' '}
              <a href={localePath('/learn/cupping', locale)} target="_blank" rel="noreferrer">
                {t('notes.whatEachMeans')}
              </a>
            </span>
          </span>

          {!cupping ? (
            <p style={{ marginBottom: 0 }}>
              <button
                type="button"
                className="bc-link-button"
                onClick={() => setCupping(true)}
                disabled={busy}
              >
                {t('notes.openFullForm')}
              </button>{' '}
              <span className="bc-muted">
                {t('notes.fullFormHint')}{' '}
                <a href={localePath('/learn/cupping', locale)} target="_blank" rel="noreferrer">
                  {t('notes.howToIdentify')}
                </a>
              </span>
            </p>
          ) : (
            <div className="bc-stack">
              <div className="bc-sca-grid">
                {SCA_FORM.map((field) => (
                  <span className="bc-field" key={field.key}>
                    <label className="bc-kit__label" htmlFor={`sca-${field.key}`}>
                      <a
                        href={`/learn/cupping#${field.key === 'body_score' ? 'body' : field.key.replace(/_/g, '-')}`}
                        target="_blank"
                        rel="noreferrer"
                        className="bc-quiet-link"
                      >
                        {field.label}
                      </a>
                    </label>
                    <select
                      id={`sca-${field.key}`}
                      className="bc-input"
                      value={attributes[field.key] ?? ''}
                      disabled={busy}
                      onChange={(event) =>
                        setAttributes((current) => ({
                          ...current,
                          [field.key]: Number(event.target.value),
                        }))
                      }
                    >
                      <option value="">—</option>
                      {STEPS.map((value) => (
                        <option key={value} value={value}>
                          {value.toFixed(2)}
                        </option>
                      ))}
                    </select>
                  </span>
                ))}
              </div>

              <div className="bc-sca-grid">
                <span className="bc-field">
                  <label className="bc-kit__label" htmlFor="sca-taints">
                    {t('notes.taints')} <span className="bc-muted">{t('notes.minusTwo')}</span>
                  </label>
                  <input
                    id="sca-taints"
                    className="bc-input"
                    type="number"
                    min={0}
                    max={5}
                    value={taints}
                    disabled={busy}
                    onChange={(event) => setTaints(Number(event.target.value))}
                  />
                </span>
                <span className="bc-field">
                  <label className="bc-kit__label" htmlFor="sca-faults">
                    {t('notes.faults')} <span className="bc-muted">{t('notes.minusFour')}</span>
                  </label>
                  <input
                    id="sca-faults"
                    className="bc-input"
                    type="number"
                    min={0}
                    max={5}
                    value={faults}
                    disabled={busy}
                    onChange={(event) => setFaults(Number(event.target.value))}
                  />
                </span>
              </div>

              <p className="bc-muted" style={{ marginBottom: 0, fontSize: '0.85rem' }}>
                {t('notes.partialFormHint')}
              </p>
            </div>
          )}

          <span className="bc-field">
            <label className="bc-kit__label" htmlFor="note-body">
              {t('notes.bodyLabel')} <span className="bc-muted">{t('common.optional')}</span>
            </label>
            <textarea
              id="note-body"
              className="bc-input"
              rows={3}
              maxLength={4000}
              placeholder={t('notes.bodyPlaceholder')}
              value={body}
              disabled={busy}
              onChange={(event) => setBody(event.target.value)}
            />
          </span>

          <span className="bc-field">
            <label className="bc-kit__label" htmlFor="note-method">
              {t('notes.methodLabel')} <span className="bc-muted">{t('common.optional')}</span>
            </label>
            <input
              id="note-method"
              className="bc-input"
              maxLength={60}
              placeholder={t('notes.methodPlaceholder')}
              value={method}
              disabled={busy}
              onChange={(event) => setMethod(event.target.value)}
            />
            {/* "Tasted thin" means something different at 1:18 than at 1:14. */}
            <span className="bc-muted" style={{ fontSize: '0.85rem' }}>
              {t('notes.methodHint')}
            </span>
          </span>

          <div className="bc-actions" style={{ marginTop: 0 }}>
            <button
              type="button"
              className="bc-button"
              disabled={busy || overall === 0}
              onClick={() => void save()}
            >
              {busy ? t('common.saving') : mine ? t('notes.update') : t('notes.post')}
            </button>
            <button
              type="button"
              className="bc-button bc-button--quiet"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              {t('common.cancel')}
            </button>
            {mine ? (
              <button
                type="button"
                className="bc-button bc-button--quiet"
                disabled={busy}
                onClick={() => void remove()}
              >
                {t('notes.deleteMine')}
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="bc-actions" style={{ marginTop: 0 }}>
          <button type="button" className="bc-button" onClick={startEditing}>
            {mine ? t('notes.edit') : t('notes.rate')}
          </button>
        </div>
      )}

      {loading ? (
        <p className="bc-muted">{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <p className="bc-muted">
          {t('notes.emptyList')}
        </p>
      ) : (
        <ul className="bc-notes">
          {items.map((item) => (
            <li key={item.id} className="bc-notes__item">
              <p className="bc-notes__head">
                <strong>
                  {item.total_score !== null
                    ? t('notes.outOf100', { score: item.total_score })
                    : t('notes.overallOnly', { score: item.overall })}
                </strong>{' '}
                <span className="bc-muted">
                  {item.author_display_name ??
                    (item.author_handle ? `@${item.author_handle}` : t('notes.someone'))}
                  {item.is_mine ? ` · ${t('notes.you')}` : ''}
                  {item.brew_method ? ` · ${item.brew_method}` : ''}
                  {item.scored_at_table ? ` · ${t('notes.cupped')}` : ''}
                </span>
              </p>
              {item.body ? <p className="bc-notes__body">{item.body}</p> : null}
              <p className="bc-notes__foot">
                {item.is_mine ? (
                  <span className="bc-muted">
                    {item.helpful_count > 0
                      ? t('notes.foundUseful', { count: item.helpful_count })
                      : t('notes.noVotes')}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="bc-button bc-button--quiet"
                    disabled={!signedIn}
                    onClick={() => void vote(item)}
                  >
                    {item.voted_helpful ? t('notes.usefulDone') : t('notes.useful')}
                    {item.helpful_count > 0 ? ` · ${item.helpful_count}` : ''}
                  </button>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
