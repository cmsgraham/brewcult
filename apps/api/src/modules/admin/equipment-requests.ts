/**
 * Proposals for the shared equipment catalogue (0011, tier 2).
 *
 * ── WHY THIS LIVES IN admin ─────────────────────────────────────────────────
 * It is a moderation queue, which is what this module already does (seller
 * applications, reports) — and it is the only home without a dependency cycle.
 * `intelligence` already imports brewing and catalog, so a queue in either of
 * those that called the drafter would close a loop. admin imports identity,
 * catalog and intelligence, and nothing imports admin.
 *
 * ── WHY A HUMAN IS IN THE MIDDLE ────────────────────────────────────────────
 * The draft comes from a model reasoning from its own knowledge, which means it
 * will occasionally be confidently wrong about a burr diameter. The catalogue
 * drives grind-setting conversions and public product pages, so that error
 * would outlive everyone's memory of it. The draft is stored as EVIDENCE
 * alongside the original submission, and only a person turns it into a row.
 */
import { slugify } from '../catalog/index.js';
import { mediaUrl } from '../media/index.js';
import type { AdminDb } from './types.js';

export type RequestStatus = 'pending' | 'approved' | 'rejected';

export interface EquipmentRequestRow {
  id: string;
  requester_id: string;
  requester_handle: string | null;
  submitted_text: string;
  /** Object key; the table stores no URL. `image_url` below is the derived one. */
  image_storage_key: string | null;
  /**
   * Where the photo actually is. Derived rather than stored, so moving the media
   * origin does not require rewriting rows — and so a stale absolute URL can
   * never outlive the bucket it points at.
   */
  image_url: string | null;
  ai_draft: Record<string, unknown> | null;
  ai_error: string | null;
  status: RequestStatus;
  decision_note: string | null;
  decided_at: string | null;
  equipment_model_id: string | null;
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
         r.equipment_model_id::text AS equipment_model_id,
         r.created_at               AS created_at
    FROM equipment_requests r
    LEFT JOIN users u ON u.id = r.requester_id
    LEFT JOIN media m ON m.id = r.image_media_id`;

/** Adds the derived media URL. Kept in one place so every reader agrees. */
function withImageUrl(row: EquipmentRequestRow): EquipmentRequestRow {
  return { ...row, image_url: row.image_storage_key ? mediaUrl(row.image_storage_key) : null };
}

export interface CreateRequestInput {
  requesterId: string;
  submittedText: string;
  imageMediaId?: string | null;
}

export type CreateRequestResult =
  | { status: 'created'; id: string }
  | { status: 'duplicate' };

/**
 * Record the submission FIRST, draft afterwards.
 *
 * The person's words are the artefact worth keeping; the draft is a
 * convenience for whoever reviews it. Writing the row before calling a model
 * means a provider outage costs a nicety, not somebody's typing.
 */
export async function createEquipmentRequest(
  db: AdminDb,
  input: CreateRequestInput,
): Promise<CreateRequestResult> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO equipment_requests (requester_id, submitted_text, image_media_id)
          VALUES ($1::uuid, $2, $3::uuid)
     ON CONFLICT DO NOTHING
       RETURNING id::text AS id`,
    [input.requesterId, input.submittedText.trim(), input.imageMediaId ?? null],
  );
  const id = res.rows[0]?.id;
  // The partial unique index means "you already have this one queued", which is
  // impatience rather than an error worth showing.
  return id ? { status: 'created', id } : { status: 'duplicate' };
}

/** Attach the assistant's proposal, or the reason there isn't one. */
export async function attachDraft(
  db: AdminDb,
  id: string,
  draft: Record<string, unknown> | null,
  error?: string | null,
): Promise<void> {
  await db.query(
    `UPDATE equipment_requests
        SET ai_draft = $2::jsonb, ai_error = $3
      WHERE id = $1::uuid`,
    [id, draft ? JSON.stringify(draft) : null, error ?? null],
  );
}

/** One person's own submissions. */
export async function listMyRequests(
  db: AdminDb,
  requesterId: string,
): Promise<EquipmentRequestRow[]> {
  const res = await db.query<EquipmentRequestRow>(
    `${SELECT} WHERE r.requester_id = $1::uuid ORDER BY r.created_at DESC LIMIT 50`,
    [requesterId],
  );
  return res.rows.map(withImageUrl);
}

/** The reviewer's queue. Oldest pending first, so nothing rots at the bottom. */
export async function listRequests(
  db: AdminDb,
  status: RequestStatus = 'pending',
): Promise<EquipmentRequestRow[]> {
  const res = await db.query<EquipmentRequestRow>(
    `${SELECT} WHERE r.status = $1
      ORDER BY CASE WHEN r.status = 'pending' THEN r.created_at END ASC,
               r.decided_at DESC NULLS LAST
      LIMIT 100`,
    [status],
  );
  return res.rows.map(withImageUrl);
}

export async function findRequest(
  db: AdminDb,
  id: string,
): Promise<EquipmentRequestRow | null> {
  const res = await db.query<EquipmentRequestRow>(`${SELECT} WHERE r.id = $1::uuid`, [id]);
  const row = res.rows[0];
  return row ? withImageUrl(row) : null;
}

export interface ApproveInput {
  id: string;
  reviewerId: string;
  /** What the reviewer decided it is — NOT necessarily what the model drafted. */
  brand: string;
  name: string;
  category: string;
  grindScaleType?: string | null;
  specs?: Record<string, unknown> | null;
}

export type DecisionResult =
  | { status: 'ok'; equipmentModelId?: string }
  | { status: 'not_found' }
  | { status: 'already_decided' }
  | { status: 'conflict'; message: string };

/**
 * Approve: create the catalogue row, then record the decision.
 *
 * The fields come from the REVIEWER, not from `ai_draft`. Reading the draft
 * here would make the human a rubber stamp — the point of the queue is that
 * somebody looked, and possibly corrected it.
 */
export async function approveRequest(
  db: AdminDb,
  input: ApproveInput,
  writers: {
    upsertBrand: (name: string) => Promise<string>;
    insertModel: (row: {
      brand_id: string;
      category: string;
      name: string;
      slug: string;
      specs?: Record<string, unknown> | null;
      grind_scale_type?: string | null;
    }) => Promise<{ id?: string; slug?: string }>;
  },
): Promise<DecisionResult> {
  const current = await findRequest(db, input.id);
  if (!current) return { status: 'not_found' };
  if (current.status !== 'pending') return { status: 'already_decided' };

  const slug = slugify(`${input.brand} ${input.name}`);
  let modelId: string | undefined;
  try {
    const brandId = await writers.upsertBrand(input.brand);
    const created = await writers.insertModel({
      brand_id: brandId,
      category: input.category,
      name: input.name,
      slug,
      specs: input.specs ?? null,
      grind_scale_type: input.grindScaleType ?? null,
    });
    modelId = created.id;
  } catch (err) {
    // Two different things land here and they need DIFFERENT words. A slug
    // collision means somebody catalogued it while this sat in the queue; a
    // rejected value means the reviewer's own entry is not admissible. Calling
    // the second one a duplicate sends them hunting for a clash that does not
    // exist — which is exactly what happened the first time this ran against a
    // grinder with no grind scale.
    //
    // catalog has already translated the driver error into something a person
    // can read, so the message is passed through rather than re-guessed from
    // the constraint name. The one exception is the grind-scale rule, whose
    // generic "domain rules" phrasing tells a reviewer nothing actionable.
    const failure = err as { statusCode?: number; message?: string; details?: unknown };
    const constraint = (failure.details as { constraint?: string } | undefined)?.constraint ?? '';

    if (constraint.includes('grind_scale')) {
      return {
        status: 'conflict',
        message: 'Grinders must declare a grind scale, and only grinders may have one.',
      };
    }
    if (failure.statusCode === 409) {
      return { status: 'conflict', message: 'Something with that name is already in the catalogue.' };
    }
    return {
      status: 'conflict',
      message: failure.message ?? 'Could not create the catalogue entry.',
    };
  }

  await db.query(
    `UPDATE equipment_requests
        SET status = 'approved',
            decided_by = $2::uuid,
            decided_at = now(),
            equipment_model_id = (SELECT id FROM equipment_models WHERE slug = $3)
      WHERE id = $1::uuid AND status = 'pending'`,
    [input.id, input.reviewerId, slug],
  );

  return modelId ? { status: 'ok', equipmentModelId: modelId } : { status: 'ok' };
}

export async function rejectRequest(
  db: AdminDb,
  id: string,
  reviewerId: string,
  note: string,
): Promise<DecisionResult> {
  const current = await findRequest(db, id);
  if (!current) return { status: 'not_found' };
  if (current.status !== 'pending') return { status: 'already_decided' };

  await db.query(
    `UPDATE equipment_requests
        SET status = 'rejected', decided_by = $2::uuid, decided_at = now(), decision_note = $3
      WHERE id = $1::uuid AND status = 'pending'`,
    [id, reviewerId, note.trim() || null],
  );
  return { status: 'ok' };
}
