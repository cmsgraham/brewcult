/**
 * Coffee submissions (0014) — the sibling of `equipment-requests.ts`.
 *
 * Lives in admin for the same reason that one does: it is the module that may
 * import both catalog and intelligence without closing a dependency loop. There
 * is no queue to work in the normal case — the assistant decides — but the
 * PENDING rows are real and a person still empties them.
 */
import { mediaUrl } from '../media/index.js';
import type { AdminDb } from './types.js';

export type CoffeeRequestStatus = 'pending' | 'approved' | 'rejected';

export interface CoffeeRequestRow {
  id: string;
  requester_id: string;
  requester_handle: string | null;
  submitted_text: string;
  /** Every side they photographed, in the order they sent them. */
  image_urls: string[];
  ai_draft: Record<string, unknown> | null;
  ai_error: string | null;
  status: CoffeeRequestStatus;
  decision_note: string | null;
  decided_at: string | null;
  coffee_product_id: string | null;
  created_at: string;
}

/**
 * The storage keys come back as an ARRAY, aggregated in the same query rather
 * than fetched per row. A submission has one to four photos and a queue has a
 * hundred submissions; N+1 here would be four hundred round trips to draw one
 * page.
 */
const SELECT = `
  SELECT r.id::text                 AS id,
         r.requester_id::text       AS requester_id,
         u.handle                   AS requester_handle,
         r.submitted_text           AS submitted_text,
         coalesce(
           (SELECT array_agg(m.storage_key ORDER BY i.position)
              FROM coffee_request_images i
              JOIN media m ON m.id = i.media_id
             WHERE i.request_id = r.id),
           '{}'
         )                          AS image_keys,
         r.ai_draft                 AS ai_draft,
         r.ai_error                 AS ai_error,
         r.status                   AS status,
         r.decision_note            AS decision_note,
         r.decided_at               AS decided_at,
         r.coffee_product_id::text  AS coffee_product_id,
         r.created_at               AS created_at
    FROM coffee_requests r
    LEFT JOIN users u ON u.id = r.requester_id`;

interface RawCoffeeRequestRow extends Omit<CoffeeRequestRow, 'image_urls'> {
  image_keys: string[] | null;
}

/** Keys become URLs here, in one place, so every reader agrees. */
const toRow = (row: RawCoffeeRequestRow): CoffeeRequestRow => {
  const { image_keys: keys, ...rest } = row;
  return { ...rest, image_urls: (keys ?? []).map((key) => mediaUrl(key)) };
};

/**
 * Record the submission first, read the label afterwards.
 *
 * No duplicate guard on the text here, unlike equipment: a coffee submission is
 * usually a PHOTO with no text at all, so "the same words twice" is not a
 * meaningful collision. Two photos of the same bag converge later, at the
 * catalogue lookup, where the comparison is on what the label actually said.
 */
export async function createCoffeeRequest(
  db: AdminDb,
  input: { requesterId: string; submittedText?: string; imageMediaIds?: readonly string[] },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO coffee_requests (requester_id, submitted_text)
          VALUES ($1::uuid, $2)
       RETURNING id::text AS id`,
    [input.requesterId, (input.submittedText ?? '').trim()],
  );
  const id = rows[0]!.id;

  // Position is the order they were sent, which is usually front then back.
  // Nothing downstream depends on that being true — the model is told it is
  // looking at sides of one bag, not at a labelled front and a labelled back.
  const images = (input.imageMediaIds ?? []).slice(0, 4);
  for (const [position, mediaId] of images.entries()) {
    await db.query(
      `INSERT INTO coffee_request_images (request_id, media_id, position)
            VALUES ($1::uuid, $2::uuid, $3)
       ON CONFLICT DO NOTHING`,
      [id, mediaId, position],
    );
  }
  return id;
}

export async function attachCoffeeDraft(
  db: AdminDb,
  id: string,
  draft: Record<string, unknown> | null,
  error?: string | null,
): Promise<void> {
  await db.query(
    `UPDATE coffee_requests SET ai_draft = $2::jsonb, ai_error = $3 WHERE id = $1::uuid`,
    [id, draft ? JSON.stringify(draft) : null, error ?? null],
  );
}

export async function findCoffeeRequest(
  db: AdminDb,
  id: string,
): Promise<CoffeeRequestRow | null> {
  const { rows } = await db.query<RawCoffeeRequestRow>(`${SELECT} WHERE r.id = $1::uuid`, [id]);
  return rows[0] ? toRow(rows[0]) : null;
}

export async function listMyCoffeeRequests(
  db: AdminDb,
  requesterId: string,
): Promise<CoffeeRequestRow[]> {
  const { rows } = await db.query<RawCoffeeRequestRow>(
    `${SELECT} WHERE r.requester_id = $1::uuid ORDER BY r.created_at DESC LIMIT 50`,
    [requesterId],
  );
  return rows.map(toRow);
}

export async function listCoffeeRequests(
  db: AdminDb,
  status: CoffeeRequestStatus = 'pending',
): Promise<CoffeeRequestRow[]> {
  const { rows } = await db.query<RawCoffeeRequestRow>(
    `${SELECT} WHERE r.status = $1 ORDER BY r.created_at DESC LIMIT 100`,
    [status],
  );
  return rows.map(toRow);
}

/** The assistant's decision, recorded as one. Same shape as 0013's. */
export async function recordCoffeeDecision(
  db: AdminDb,
  input: {
    id: string;
    status: 'approved' | 'rejected';
    coffeeProductId?: string | null;
    note?: string | null;
  },
): Promise<void> {
  await db.query(
    `UPDATE coffee_requests
        SET status = $2,
            decided_by_assistant = true,
            decided_at = now(),
            decision_note = $3,
            coffee_product_id = $4::uuid
      WHERE id = $1::uuid AND status = 'pending'`,
    [input.id, input.status, input.note?.slice(0, 1000) ?? null, input.coffeeProductId ?? null],
  );
}

export interface CommunityCoffeeRow {
  id: string;
  slug: string;
  name: string;
  roaster: string | null;
  roaster_verified: boolean;
  submitted_by_handle: string | null;
  created_at: string;
}

/**
 * Published coffees nobody has confirmed.
 *
 * Carries `roaster_verified` because that is the column with teeth here: a
 * community submission mints an UNVERIFIED roaster, and a reviewer looking at
 * this list is deciding about a business as much as about a coffee.
 */
export async function listUnreviewedCommunityCoffee(
  db: AdminDb,
  limit = 100,
): Promise<CommunityCoffeeRow[]> {
  const { rows } = await db.query<CommunityCoffeeRow>(
    `SELECT cp.id::text AS id, cp.slug, cp.name,
            r.name       AS roaster,
            r.verified   AS roaster_verified,
            u.handle     AS submitted_by_handle,
            cp.created_at
       FROM coffee_products cp
       JOIN roasters r ON r.id = cp.roaster_id
       LEFT JOIN users u ON u.id = cp.submitted_by
      WHERE cp.source = 'community' AND cp.reviewed_at IS NULL
      ORDER BY cp.created_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows;
}

export async function markCoffeeReviewed(
  db: AdminDb,
  coffeeProductId: string,
  reviewerId: string,
): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE coffee_products
        SET reviewed_at = now(), reviewed_by = $2::uuid
      WHERE id = $1::uuid AND reviewed_at IS NULL
      RETURNING id::text AS id`,
    [coffeeProductId, reviewerId],
  );
  return rows.length > 0;
}
