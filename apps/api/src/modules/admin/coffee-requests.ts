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
  image_storage_key: string | null;
  image_url: string | null;
  ai_draft: Record<string, unknown> | null;
  ai_error: string | null;
  status: CoffeeRequestStatus;
  decision_note: string | null;
  decided_at: string | null;
  coffee_product_id: string | null;
  created_at: string;
}

const SELECT = `
  SELECT r.id::text                 AS id,
         r.requester_id::text       AS requester_id,
         u.handle                   AS requester_handle,
         r.submitted_text           AS submitted_text,
         m.storage_key              AS image_storage_key,
         r.ai_draft                 AS ai_draft,
         r.ai_error                 AS ai_error,
         r.status                   AS status,
         r.decision_note            AS decision_note,
         r.decided_at               AS decided_at,
         r.coffee_product_id::text  AS coffee_product_id,
         r.created_at               AS created_at
    FROM coffee_requests r
    LEFT JOIN users u ON u.id = r.requester_id
    LEFT JOIN media m ON m.id = r.image_media_id`;

const withImageUrl = (row: CoffeeRequestRow): CoffeeRequestRow => ({
  ...row,
  image_url: row.image_storage_key ? mediaUrl(row.image_storage_key) : null,
});

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
  input: { requesterId: string; submittedText?: string; imageMediaId?: string | null },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO coffee_requests (requester_id, submitted_text, image_media_id)
          VALUES ($1::uuid, $2, $3::uuid)
       RETURNING id::text AS id`,
    [input.requesterId, (input.submittedText ?? '').trim(), input.imageMediaId ?? null],
  );
  return rows[0]!.id;
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
  const { rows } = await db.query<CoffeeRequestRow>(`${SELECT} WHERE r.id = $1::uuid`, [id]);
  return rows[0] ? withImageUrl(rows[0]) : null;
}

export async function listMyCoffeeRequests(
  db: AdminDb,
  requesterId: string,
): Promise<CoffeeRequestRow[]> {
  const { rows } = await db.query<CoffeeRequestRow>(
    `${SELECT} WHERE r.requester_id = $1::uuid ORDER BY r.created_at DESC LIMIT 50`,
    [requesterId],
  );
  return rows.map(withImageUrl);
}

export async function listCoffeeRequests(
  db: AdminDb,
  status: CoffeeRequestStatus = 'pending',
): Promise<CoffeeRequestRow[]> {
  const { rows } = await db.query<CoffeeRequestRow>(
    `${SELECT} WHERE r.status = $1 ORDER BY r.created_at DESC LIMIT 100`,
    [status],
  );
  return rows.map(withImageUrl);
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
