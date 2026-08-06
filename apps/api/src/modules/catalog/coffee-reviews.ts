/**
 * Notes people leave on a coffee (0016).
 *
 * ── WHY THIS LIVES IN catalog ───────────────────────────────────────────────
 * The rows hang off `coffee_products`, the aggregate is rendered on the same
 * card as the coffee itself, and every read here joins the catalogue. Putting
 * it anywhere else would mean a second module writing catalog's tables — the
 * exact thing media documents as an exception rather than a pattern.
 *
 * ── THE BODY IS UNTRUSTED, FOREVER ──────────────────────────────────────────
 * Everything in `body` was typed by one member for other members to read, which
 * makes it the classic injection channel into any AI feature that later
 * summarises a coffee. It is stored verbatim and fenced at the point of USE
 * (prompts/untrusted.ts already has a `review_body` source for exactly this).
 * Nothing here sanitises it: escaping on write is how you end up with
 * &amp;amp; in somebody's tasting note three refactors later.
 */
import { badRequest, notFound } from '../../lib/errors.js';
import type { CatalogDb } from './repository.js';

export interface CoffeeReview {
  id: string;
  coffee_product_id: string;
  author_handle: string | null;
  author_display_name: string | null;
  rating: number;
  body: string | null;
  brew_method: string | null;
  helpful_count: number;
  /** Whether the CALLER found this useful. Null for anonymous readers. */
  voted_helpful: boolean | null;
  is_mine: boolean;
  created_at: string;
  updated_at: string;
}

export interface CoffeeRatingSummary {
  /** Rounded to one decimal. Null when nobody has rated it. */
  average: number | null;
  count: number;
}

const SELECT = `
  SELECT r.id::text                AS id,
         r.coffee_product_id::text AS coffee_product_id,
         u.handle                  AS author_handle,
         u.display_name            AS author_display_name,
         r.rating                  AS rating,
         r.body                    AS body,
         r.brew_method             AS brew_method,
         (SELECT count(*)::int FROM coffee_review_votes v WHERE v.review_id = r.id)
                                   AS helpful_count,
         CASE
           WHEN $2::uuid IS NULL THEN NULL
           ELSE EXISTS (
             SELECT 1 FROM coffee_review_votes v
              WHERE v.review_id = r.id AND v.user_id = $2::uuid
           )
         END                       AS voted_helpful,
         ($2::uuid IS NOT NULL AND r.user_id = $2::uuid) AS is_mine,
         r.created_at              AS created_at,
         r.updated_at              AS updated_at
    FROM coffee_reviews r
    JOIN users u ON u.id = r.user_id`;

/**
 * Everyone's notes on one coffee.
 *
 * Ordered by usefulness, then recency — but YOUR OWN note first regardless.
 * Somebody who has just written something and cannot find it assumes it did not
 * save, and writes it again.
 */
export async function listCoffeeReviews(
  db: CatalogDb,
  coffeeProductId: string,
  viewerId: string | null,
): Promise<CoffeeReview[]> {
  const { rows } = await db.query<CoffeeReview>(
    `${SELECT}
      WHERE r.coffee_product_id = $1::uuid AND r.hidden_at IS NULL
      ORDER BY ($2::uuid IS NOT NULL AND r.user_id = $2::uuid) DESC,
               (SELECT count(*) FROM coffee_review_votes v WHERE v.review_id = r.id) DESC,
               r.created_at DESC
      LIMIT 200`,
    [coffeeProductId, viewerId],
  );
  return rows;
}

/** The number on the card. */
export async function ratingSummary(
  db: CatalogDb,
  coffeeProductId: string,
): Promise<CoffeeRatingSummary> {
  const { rows } = await db.query<{ average: string | null; count: string }>(
    `SELECT round(avg(rating)::numeric, 1)::text AS average, count(*)::text AS count
       FROM coffee_reviews
      WHERE coffee_product_id = $1::uuid AND hidden_at IS NULL`,
    [coffeeProductId],
  );
  const row = rows[0];
  return {
    average: row?.average ? Number(row.average) : null,
    count: Number(row?.count ?? 0),
  };
}

export interface UpsertReviewInput {
  coffeeProductId: string;
  userId: string;
  rating: number;
  body?: string | null;
  brewMethod?: string | null;
}

/**
 * Leave a note, or change the one you left.
 *
 * An upsert rather than insert-or-fail: from the person's side there is one
 * note that they edit, and making them discover a "you already reviewed this"
 * error before finding the edit control is a worse version of the same thing.
 */
export async function upsertCoffeeReview(
  db: CatalogDb,
  input: UpsertReviewInput,
): Promise<CoffeeReview> {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    throw badRequest('Pick a rating from one to five.');
  }
  const body = input.body?.trim() || null;
  if (body && body.length > 4000) throw badRequest('That note is a bit long — 4000 characters or fewer.');
  const method = input.brewMethod?.trim() || null;
  if (method && method.length > 60) throw badRequest('Keep the method short — 60 characters or fewer.');

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO coffee_reviews (coffee_product_id, user_id, rating, body, brew_method)
          VALUES ($1::uuid, $2::uuid, $3, $4, $5)
     ON CONFLICT (coffee_product_id, user_id)
     DO UPDATE SET rating = EXCLUDED.rating,
                   body = EXCLUDED.body,
                   brew_method = EXCLUDED.brew_method
       RETURNING id::text AS id`,
    [input.coffeeProductId, input.userId, input.rating, body, method],
  );

  const id = rows[0]?.id;
  if (!id) throw notFound('That coffee is not in the catalogue.');
  const review = await findReview(db, id, input.userId);
  if (!review) throw notFound('That note has gone.');
  return review;
}

export async function findReview(
  db: CatalogDb,
  id: string,
  viewerId: string | null,
): Promise<CoffeeReview | null> {
  const { rows } = await db.query<CoffeeReview>(`${SELECT} WHERE r.id = $1::uuid`, [id, viewerId]);
  return rows[0] ?? null;
}

/** Take back your own note. Deleted outright — it is yours, not a record. */
export async function deleteCoffeeReview(
  db: CatalogDb,
  id: string,
  userId: string,
): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `DELETE FROM coffee_reviews WHERE id = $1::uuid AND user_id = $2::uuid RETURNING id::text AS id`,
    [id, userId],
  );
  return rows.length > 0;
}

export type VoteResult = 'added' | 'removed' | 'own_review' | 'not_found';

/**
 * Mark somebody's note useful, or take it back.
 *
 * A toggle rather than two endpoints: the button says one thing and means its
 * own opposite when it is already on, which is how every other vote control a
 * person has ever used behaves.
 */
export async function toggleHelpful(
  db: CatalogDb,
  reviewId: string,
  userId: string,
): Promise<VoteResult> {
  const { rows } = await db.query<{ user_id: string }>(
    `SELECT user_id::text AS user_id FROM coffee_reviews
      WHERE id = $1::uuid AND hidden_at IS NULL`,
    [reviewId],
  );
  const author = rows[0]?.user_id;
  if (!author) return 'not_found';
  // The database refuses this too (0016's trigger). Answering here means the
  // person gets a sentence instead of a 500.
  if (author === userId) return 'own_review';

  const removed = await db.query<{ review_id: string }>(
    `DELETE FROM coffee_review_votes
      WHERE review_id = $1::uuid AND user_id = $2::uuid
      RETURNING review_id::text AS review_id`,
    [reviewId, userId],
  );
  if (removed.rows.length > 0) return 'removed';

  await db.query(
    `INSERT INTO coffee_review_votes (review_id, user_id) VALUES ($1::uuid, $2::uuid)
     ON CONFLICT DO NOTHING`,
    [reviewId, userId],
  );
  return 'added';
}

/** Moderation: hidden, not deleted, so the decision can be reviewed. */
export async function hideCoffeeReview(
  db: CatalogDb,
  id: string,
  moderatorId: string,
  reason: string,
): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE coffee_reviews
        SET hidden_at = now(), hidden_by = $2::uuid, hidden_reason = $3
      WHERE id = $1::uuid AND hidden_at IS NULL
      RETURNING id::text AS id`,
    [id, moderatorId, reason.trim().slice(0, 500) || null],
  );
  return rows.length > 0;
}
