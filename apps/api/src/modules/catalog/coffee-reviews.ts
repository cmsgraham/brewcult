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

/**
 * The ten attributes of the SCA cupping form, in the order the form prints
 * them. Exported because the UI renders the same list and a second copy would
 * drift.
 */
export const SCA_ATTRIBUTES = [
  'fragrance_aroma',
  'flavour',
  'aftertaste',
  'acidity',
  // `body_score`, not `body`, everywhere outside the cupping form itself: the
  // prose column got the plain name first (0016) and a DTO with two `body`
  // fields meaning different things is a bug waiting for a careless reader.
  'body_score',
  'uniformity',
  'balance',
  'clean_cup',
  'sweetness',
  'overall',
] as const;

export type ScaAttribute = (typeof SCA_ATTRIBUTES)[number];

/**
 * 6.00–10.00 in quarter points, per the protocol.
 *
 * The floor is 6 because the form exists to grade SPECIALTY coffee; anything
 * below that has a defect, and defects are counted separately as taints and
 * faults rather than by scoring an attribute at 3.
 */
export function isScaScore(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 6 &&
    value <= 10 &&
    Number.isInteger(value * 4)
  );
}

export interface CoffeeReview {
  id: string;
  coffee_product_id: string;
  author_handle: string | null;
  author_display_name: string | null;
  /** SCA "Overall", 6.00–10.00. Always present. */
  overall: number;
  /** The full form, when one was filled in. */
  fragrance_aroma: number | null;
  flavour: number | null;
  aftertaste: number | null;
  acidity: number | null;
  body_score: number | null;
  uniformity: number | null;
  balance: number | null;
  clean_cup: number | null;
  sweetness: number | null;
  taint_cups: number;
  fault_cups: number;
  scored_at_table: boolean;
  /** Out of 100. Null unless the whole form is present. */
  total_score: number | null;
  /** Their words. Not to be confused with `body_score`, which is the attribute. */
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
  /**
   * The average SCA "Overall", 6–10. Null when nobody has scored it.
   *
   * This is the number every note carries, so it is the one that can be
   * averaged across all of them.
   */
  average_overall: number | null;
  /**
   * The average full cupping score out of 100, across the notes that HAVE one.
   * Null when nobody has cupped it — which is most coffees, and is why the two
   * numbers are reported separately rather than mixed into one.
   */
  average_cupping: number | null;
  /** How many of the notes were full cupping forms. */
  cupped_count: number;
  count: number;
}

const SELECT = `
  SELECT r.id::text                AS id,
         r.coffee_product_id::text AS coffee_product_id,
         u.handle                  AS author_handle,
         u.display_name            AS author_display_name,
         r.overall::float8         AS overall,
         r.fragrance_aroma::float8 AS fragrance_aroma,
         r.flavour::float8         AS flavour,
         r.aftertaste::float8      AS aftertaste,
         r.acidity::float8         AS acidity,
         r.body_score::float8      AS body_score,
         r.uniformity::float8      AS uniformity,
         r.balance::float8         AS balance,
         r.clean_cup::float8       AS clean_cup,
         r.sweetness::float8       AS sweetness,
         r.taint_cups              AS taint_cups,
         r.fault_cups              AS fault_cups,
         r.scored_at_table         AS scored_at_table,
         r.total_score::float8     AS total_score,
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
  const { rows } = await db.query<{
    average_overall: string | null;
    average_cupping: string | null;
    cupped_count: string;
    count: string;
  }>(
    `SELECT round(avg(overall)::numeric, 2)::text     AS average_overall,
            round(avg(total_score)::numeric, 2)::text AS average_cupping,
            count(total_score)::text                  AS cupped_count,
            count(*)::text                            AS count
       FROM coffee_reviews
      WHERE coffee_product_id = $1::uuid AND hidden_at IS NULL`,
    [coffeeProductId],
  );
  const row = rows[0];
  return {
    average_overall: row?.average_overall ? Number(row.average_overall) : null,
    average_cupping: row?.average_cupping ? Number(row.average_cupping) : null,
    cupped_count: Number(row?.cupped_count ?? 0),
    count: Number(row?.count ?? 0),
  };
}

export interface UpsertReviewInput {
  coffeeProductId: string;
  userId: string;
  /** SCA "Overall". The only score required of anybody. */
  overall: number;
  /** The other nine, all-or-nothing: a partial form has no total. */
  attributes?: Partial<Record<Exclude<ScaAttribute, 'overall'>, number>>;
  taintCups?: number;
  faultCups?: number;
  scoredAtTable?: boolean;
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
  if (!isScaScore(input.overall)) {
    throw badRequest('Score it from 6 to 10, in quarter points — the SCA scale.');
  }
  const attributes = input.attributes ?? {};
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) continue;
    if (!isScaScore(value)) {
      throw badRequest(`${name.replace(/_/g, ' ')} must be 6 to 10, in quarter points.`);
    }
  }
  const taints = input.taintCups ?? 0;
  const faults = input.faultCups ?? 0;
  if (!Number.isInteger(taints) || taints < 0 || taints > 5) {
    throw badRequest('Tainted cups: a whole number from 0 to 5.');
  }
  if (!Number.isInteger(faults) || faults < 0 || faults > 5) {
    throw badRequest('Faulty cups: a whole number from 0 to 5.');
  }
  const body = input.body?.trim() || null;
  if (body && body.length > 4000) throw badRequest('That note is a bit long — 4000 characters or fewer.');
  const method = input.brewMethod?.trim() || null;
  if (method && method.length > 60) throw badRequest('Keep the method short — 60 characters or fewer.');

  const attr = (name: Exclude<ScaAttribute, 'overall'>): number | null =>
    attributes[name] ?? null;

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO coffee_reviews
            (coffee_product_id, user_id, overall, body, brew_method,
             fragrance_aroma, flavour, aftertaste, acidity, body_score,
             uniformity, balance, clean_cup, sweetness,
             taint_cups, fault_cups, scored_at_table)
          VALUES ($1::uuid, $2::uuid, $3, $4, $5,
                  $6, $7, $8, $9, $10,
                  $11, $12, $13, $14,
                  $15, $16, $17)
     ON CONFLICT (coffee_product_id, user_id)
     DO UPDATE SET overall = EXCLUDED.overall,
                   body = EXCLUDED.body,
                   brew_method = EXCLUDED.brew_method,
                   fragrance_aroma = EXCLUDED.fragrance_aroma,
                   flavour = EXCLUDED.flavour,
                   aftertaste = EXCLUDED.aftertaste,
                   acidity = EXCLUDED.acidity,
                   body_score = EXCLUDED.body_score,
                   uniformity = EXCLUDED.uniformity,
                   balance = EXCLUDED.balance,
                   clean_cup = EXCLUDED.clean_cup,
                   sweetness = EXCLUDED.sweetness,
                   taint_cups = EXCLUDED.taint_cups,
                   fault_cups = EXCLUDED.fault_cups,
                   scored_at_table = EXCLUDED.scored_at_table
       RETURNING id::text AS id`,
    [
      input.coffeeProductId,
      input.userId,
      input.overall,
      body,
      method,
      attr('fragrance_aroma'),
      attr('flavour'),
      attr('aftertaste'),
      attr('acidity'),
      attr('body_score'),
      attr('uniformity'),
      attr('balance'),
      attr('clean_cup'),
      attr('sweetness'),
      taints,
      faults,
      input.scoredAtTable === true,
    ],
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
