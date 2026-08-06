'use client';

import { useEffect, useState } from 'react';
import { hasSessionHint, isApiError } from '../../lib/api';
import {
  deleteMyReview,
  fetchCoffeeReviews,
  saveMyReview,
  toggleHelpful,
  type CoffeeRatingSummary,
  type CoffeeReview,
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
const RATINGS = [1, 2, 3, 4, 5] as const;

const RATING_WORD: Record<number, string> = {
  1: 'Not for me',
  2: 'Drinkable',
  3: 'Good',
  4: 'Really good',
  5: 'Would buy again',
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
  const [summary, setSummary] = useState<CoffeeRatingSummary>({ average: null, count: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [method, setMethod] = useState('');
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
    setRating(mine?.rating ?? 0);
    setBody(mine?.body ?? '');
    setMethod(mine?.brew_method ?? '');
    setEditing(true);
    setError(null);
  }

  async function save(): Promise<void> {
    if (rating === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await saveMyReview(slug, {
        rating,
        ...(body.trim() ? { body: body.trim() } : {}),
        ...(method.trim() ? { brew_method: method.trim() } : {}),
      });
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
            · {summary.average} out of 5 from {summary.count}{' '}
            {summary.count === 1 ? 'person' : 'people'}
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
          <fieldset className="bc-rating" disabled={busy}>
            <legend className="bc-kit__label">How was it?</legend>
            {RATINGS.map((value) => (
              <label key={value} className="bc-rating__option">
                <input
                  type="radio"
                  name="coffee-rating"
                  value={value}
                  checked={rating === value}
                  onChange={() => setRating(value)}
                />
                <span>
                  {value} <span className="bc-muted">{RATING_WORD[value]}</span>
                </span>
              </label>
            ))}
          </fieldset>

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
              disabled={busy || rating === 0}
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
                <strong>{item.rating}/5</strong>{' '}
                <span className="bc-muted">
                  {item.author_display_name ?? (item.author_handle ? `@${item.author_handle}` : 'Someone')}
                  {item.is_mine ? ' · you' : ''}
                  {item.brew_method ? ` · ${item.brew_method}` : ''}
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
