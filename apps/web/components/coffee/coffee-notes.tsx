'use client';

import { useEffect, useState } from 'react';
import { hasSessionHint, isApiError } from '../../lib/api';
import {
  SCA_ANCHORS,
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

/** The word the form prints beside each whole number. */
const anchorFor = (value: number): string =>
  SCA_ANCHORS.slice().reverse().find((anchor) => value >= anchor.value)?.word ?? '';

const EMPTY_SUMMARY: CoffeeRatingSummary = {
  average_overall: null,
  average_cupping: null,
  cupped_count: 0,
  count: 0,
};

export function CoffeeNotes({ slug }: { slug: string }) {
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
        isApiError(failure) ? failure.userMessage : 'That did not save. Try again in a moment.',
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
      setError(isApiError(failure) ? failure.userMessage : 'That did not delete.');
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
      setError(isApiError(failure) ? failure.userMessage : 'That did not register.');
    }
  }

  return (
    <section aria-labelledby="notes-heading" className="bc-stack">
      <h2 id="notes-heading">
        What people thought
        {summary.count > 0 ? (
          <span className="bc-muted" style={{ fontSize: '1rem', fontWeight: 400 }}>
            {' '}
            · {summary.average_overall} overall from {summary.count}{' '}
            {summary.count === 1 ? 'person' : 'people'}
            {summary.average_cupping !== null
              ? ` · ${summary.average_cupping} cupping score from ${summary.cupped_count}`
              : ''}
          </span>
        ) : null}
      </h2>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {!signedIn ? (
        <p className="bc-muted">
          <a href={`/login?next=${encodeURIComponent(`/coffee/${slug}`)}`}>Sign in</a> to rate this
          one or leave a note.
        </p>
      ) : editing ? (
        <div className="bc-panel bc-stack">
          <span className="bc-field">
            <label className="bc-kit__label" htmlFor="sca-overall">
              Overall — the SCA scale, 6 to 10
            </label>
            <select
              id="sca-overall"
              className="bc-input"
              value={overall || ''}
              disabled={busy}
              onChange={(event) => setOverall(Number(event.target.value))}
            >
              <option value="">Pick a score…</option>
              {STEPS.map((value) => (
                <option key={value} value={value}>
                  {value.toFixed(2)} — {anchorFor(value)}
                </option>
              ))}
            </select>
            {/* The scale is not ours, and saying so is the point of using it. */}
            <span className="bc-muted" style={{ fontSize: '0.85rem' }}>
              The same scale a cupping table uses — 80+ across the full form is what
              &ldquo;specialty&rdquo; means.{' '}
              <a href="/learn/cupping" target="_blank" rel="noreferrer">
                What each factor means
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
                Score the full cupping form
              </button>{' '}
              <span className="bc-muted">
                — nine more attributes, for a score out of 100.{' '}
                <a href="/learn/cupping" target="_blank" rel="noreferrer">
                  How to identify each one
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
                    Tainted cups <span className="bc-muted">(−2 each)</span>
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
                    Faulty cups <span className="bc-muted">(−4 each)</span>
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
                All nine plus Overall gives a score out of 100. Leave any blank and the note
                still counts — it simply has no total, which is honest rather than
                approximate.
              </p>
            </div>
          )}

          <span className="bc-field">
            <label className="bc-kit__label" htmlFor="note-body">
              Anything worth saying <span className="bc-muted">(optional)</span>
            </label>
            <textarea
              id="note-body"
              className="bc-input"
              rows={3}
              maxLength={4000}
              placeholder="What it tasted like, what worked, what you would change."
              value={body}
              disabled={busy}
              onChange={(event) => setBody(event.target.value)}
            />
          </span>

          <span className="bc-field">
            <label className="bc-kit__label" htmlFor="note-method">
              How you brewed it <span className="bc-muted">(optional)</span>
            </label>
            <input
              id="note-method"
              className="bc-input"
              maxLength={60}
              placeholder="V60, 1:16, 94°C"
              value={method}
              disabled={busy}
              onChange={(event) => setMethod(event.target.value)}
            />
            {/* "Tasted thin" means something different at 1:18 than at 1:14. */}
            <span className="bc-muted" style={{ fontSize: '0.85rem' }}>
              Context settles arguments a note on its own starts.
            </span>
          </span>

          <div className="bc-actions" style={{ marginTop: 0 }}>
            <button
              type="button"
              className="bc-button"
              disabled={busy || overall === 0}
              onClick={() => void save()}
            >
              {busy ? 'Saving…' : mine ? 'Update my note' : 'Post my note'}
            </button>
            <button
              type="button"
              className="bc-button bc-button--quiet"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
            {mine ? (
              <button
                type="button"
                className="bc-button bc-button--quiet"
                disabled={busy}
                onClick={() => void remove()}
              >
                Delete my note
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="bc-actions" style={{ marginTop: 0 }}>
          <button type="button" className="bc-button" onClick={startEditing}>
            {mine ? 'Edit my note' : 'Rate this coffee'}
          </button>
        </div>
      )}

      {loading ? (
        <p className="bc-muted">Loading notes…</p>
      ) : items.length === 0 ? (
        <p className="bc-muted">
          Nobody has said anything yet. If you have had this one, you know more about it than
          anybody reading this page.
        </p>
      ) : (
        <ul className="bc-notes">
          {items.map((item) => (
            <li key={item.id} className="bc-notes__item">
              <p className="bc-notes__head">
                <strong>
                  {item.total_score !== null
                    ? `${item.total_score}/100`
                    : `${item.overall} overall`}
                </strong>{' '}
                <span className="bc-muted">
                  {item.author_display_name ?? (item.author_handle ? `@${item.author_handle}` : 'Someone')}
                  {item.is_mine ? ' · you' : ''}
                  {item.brew_method ? ` · ${item.brew_method}` : ''}
                  {item.scored_at_table ? ' · cupped' : ''}
                </span>
              </p>
              {item.body ? <p className="bc-notes__body">{item.body}</p> : null}
              <p className="bc-notes__foot">
                {item.is_mine ? (
                  <span className="bc-muted">
                    {item.helpful_count > 0
                      ? `${item.helpful_count} found this useful`
                      : 'No votes yet'}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="bc-button bc-button--quiet"
                    disabled={!signedIn}
                    onClick={() => void vote(item)}
                  >
                    {item.voted_helpful ? 'Useful ✓' : 'Useful'}
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
