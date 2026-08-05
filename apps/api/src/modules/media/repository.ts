/**
 * Media repository — the ONLY place in this module that writes SQL.
 *
 * Rules (EF §3.3, §1.2):
 *  - Parameterised queries only. Nothing user-supplied is ever concatenated
 *    into a statement; the only interpolated strings below are the fixed table
 *    and column names in `ATTACHMENTS`, which come from a closed const map and
 *    can never take a value from a request.
 *  - Route handlers never see rows — they receive DTOs from `./types.js`.
 *
 * ── TABLE OWNERSHIP: THE DOCUMENTED EXCEPTION ───────────────────────────────
 * This module OWNS `media` (0008) and reads and writes it freely.
 *
 * It also writes exactly FOUR columns on tables owned by other modules:
 *     users.avatar_media_id             (identity)
 *     coffee_products.image_media_id    (catalog)
 *     equipment_models.image_media_id   (catalog)
 *     roasters.image_media_id           (catalog)
 * plus it READS `brew_sessions.photo_media_id` (brewing) to answer "is this
 * media still attached to anything?".
 *
 * The exception is bounded and deliberate — the reasoning is in the header of
 * db/migrations/0008_media.sql, and the boundary is kept intact three ways:
 *   1. Every statement below against another module's table touches ONLY the
 *      attachment column. There is no INSERT and no DELETE against `users`,
 *      `coffee_products`, `equipment_models`, `roasters` or `brew_sessions` in
 *      this file, and no UPDATE of any other column — grep for it.
 *   2. Every such write is reachable from exactly two authorized, audited
 *      routes (`PUT /v1/users/me/avatar`, `PUT /v1/admin/media/attach`).
 *   3. The statements are generated from ONE declaration (`ATTACHMENTS`), so
 *      the day identity publishes `setUserAvatar()` and catalog publishes
 *      `setEntityImage()` there is a single place to delete.
 * Recorded as a follow-up in the lane report.
 */

import { query as poolQuery, transaction as poolTransaction } from '../../lib/db.js';
import type {
  AttachTargetType,
  Exec,
  MediaDb,
  MediaKind,
  MediaRef,
  MediaResource,
  MediaRow,
  MediaStatus,
  QuotaUsage,
} from './types.js';

// ---------------------------------------------------------------------------
// Seam plumbing (mirrors modules/admin/repository.ts)
// ---------------------------------------------------------------------------

/** Default seam: the shared application pool. */
export const defaultMediaDb: MediaDb = {
  query: async <T>(text: string, params: readonly unknown[] = []) =>
    poolQuery(text, params) as unknown as Promise<{ rows: T[] }>,
  transaction: async <T>(fn: (tx: MediaDb) => Promise<T>): Promise<T> =>
    poolTransaction(async (client) =>
      fn({
        query: async <R>(text: string, params: readonly unknown[] = []) =>
          client.query(text, params as unknown[]) as unknown as Promise<{ rows: R[] }>,
      }),
    ),
};

/** Runs `fn` in a transaction when the seam supports one; inline otherwise. */
export function withTransaction<T>(db: MediaDb, fn: (tx: MediaDb) => Promise<T>): Promise<T> {
  return db.transaction ? db.transaction(fn) : fn(db);
}

/** Adapter for identity's published writers, which take a bare exec function. */
export const execOf =
  (db: MediaDb): Exec =>
  <T>(text: string, params?: readonly unknown[]) =>
    db.query<T>(text, params) as Promise<{ rows: T[] }>;

/** Normalises either accepted executor shape into a `.query`-style seam. */
export function dbOf(executor: Exec | MediaDb): MediaDb {
  if (typeof executor !== 'function') return executor;
  const exec = executor as (
    text: string,
    params?: readonly unknown[],
  ) => Promise<{ rows: unknown[] }>;
  return {
    query: <T>(text: string, params?: readonly unknown[]) =>
      exec(text, params) as Promise<{ rows: T[] }>,
  };
}

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const MEDIA_COLUMNS = `
  id::text                AS id,
  owner_id::text          AS owner_id,
  uploaded_by::text       AS uploaded_by,
  kind,
  storage_key,
  thumbnail_key,
  mime_type,
  byte_size::bigint       AS byte_size,
  width,
  height,
  checksum_sha256,
  status,
  created_at,
  updated_at
`;

interface RawMediaRow {
  id: string;
  owner_id: string | null;
  uploaded_by: string | null;
  kind: MediaKind;
  storage_key: string;
  thumbnail_key: string | null;
  mime_type: string;
  byte_size: string | number;
  width: number | null;
  height: number | null;
  checksum_sha256: string;
  status: MediaStatus;
  created_at: Date | string;
  updated_at: Date | string;
}

/** `bigint` comes back as a string from node-postgres; normalise once, here. */
const toRow = (raw: RawMediaRow): MediaRow => ({
  ...raw,
  byte_size: Number(raw.byte_size),
  created_at: toIso(raw.created_at),
  updated_at: toIso(raw.updated_at),
});

// ---------------------------------------------------------------------------
// Attachment declaration — the single source of truth for the cross-module
// columns. Every statement that touches another module's table is generated
// from this map; nothing here can ever take a value from a request.
// ---------------------------------------------------------------------------

interface AttachmentTable {
  table: string;
  column: string;
}

const ATTACHMENTS = {
  user_avatar: { table: 'users', column: 'avatar_media_id' },
  coffee_product: { table: 'coffee_products', column: 'image_media_id' },
  equipment_model: { table: 'equipment_models', column: 'image_media_id' },
  roaster: { table: 'roasters', column: 'image_media_id' },
} as const satisfies Record<string, AttachmentTable>;

type AttachmentKey = keyof typeof ATTACHMENTS;

const attachmentOf = (target: AttachTargetType): AttachmentTable => ATTACHMENTS[target];

/**
 * "Set this attachment column, tell me what it was" as one statement.
 *
 * A data-modifying CTE is used rather than SELECT-then-UPDATE so the previous
 * value and the new one come from the same snapshot — two round trips would let
 * a concurrent avatar change slip between them and strand the old object in the
 * bucket. Postgres always executes a data-modifying WITH clause exactly once,
 * to completion, whether or not the primary query reads it; the outer SELECT
 * exists only to return the prior value (and to yield zero rows when the target
 * id does not exist, which is how callers detect a 404).
 *
 * `table`/`column` are compile-time constants from `ATTACHMENTS`. $1 = target
 * row id, $2 = media id or NULL.
 */
const swapSql = (table: string, column: string): string => `
  WITH before AS (
    SELECT ${column} AS previous FROM ${table} WHERE id = $1::uuid
  ), updated AS (
    UPDATE ${table} SET ${column} = $2::uuid WHERE id = $1::uuid RETURNING id
  )
  SELECT before.previous::text AS previous FROM before
`;

/**
 * `EXISTS` over every P0-public attachment point. A media row is publicly
 * readable when some public entity currently points at it — the avatar on a
 * profile, the bag shot on a coffee, the logo on a roaster. `brew_sessions` is
 * pointedly NOT in this list: a brew photo is P1 and stays private to its owner
 * even though the column exists.
 */
const PUBLIC_ATTACHMENT_SQL = (Object.keys(ATTACHMENTS) as AttachmentKey[])
  .map((key) => {
    const { table, column } = ATTACHMENTS[key];
    return `EXISTS (SELECT 1 FROM ${table} t WHERE t.${column} = m.id)`;
  })
  .join(' OR ');

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function findMediaById(db: MediaDb, id: string): Promise<MediaRow | null> {
  const { rows } = await db.query<RawMediaRow>(
    `SELECT ${MEDIA_COLUMNS} FROM media WHERE id = $1::uuid`,
    [id],
  );
  return rows[0] ? toRow(rows[0]) : null;
}

/**
 * Loads the policy resource for `id` — ownership, status, kind and whether the
 * row hangs off a public entity — in ONE round trip. The policy layer never
 * queries; it is handed this.
 */
export async function loadMediaResource(db: MediaDb, id: string): Promise<MediaResource | null> {
  const { rows } = await db.query<{
    id: string;
    owner_id: string | null;
    status: MediaStatus;
    kind: MediaKind;
    public_attachment: boolean;
  }>(
    `SELECT m.id::text        AS id,
            m.owner_id::text  AS owner_id,
            m.status,
            m.kind,
            (${PUBLIC_ATTACHMENT_SQL}) AS public_attachment
       FROM media m
      WHERE m.id = $1::uuid`,
    [id],
  );
  return rows[0] ?? null;
}

/** Minimal reference for `assertMediaUsable()`. */
export async function findMediaRef(db: MediaDb, id: string): Promise<MediaRef | null> {
  const { rows } = await db.query<MediaRef>(
    `SELECT id::text AS id, kind, owner_id::text AS owner_id, status
       FROM media WHERE id = $1::uuid`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Every storage key a user owns. Published for the account-deletion job
 * (BREW-10): the FK cascade removes the ROWS, so the objects have to be
 * enumerated and purged BEFORE the user is deleted or they are orphaned in the
 * bucket forever (0008 header).
 */
export async function listOwnedStorageKeys(db: MediaDb, userId: string): Promise<string[]> {
  const { rows } = await db.query<{ storage_key: string; thumbnail_key: string | null }>(
    `SELECT storage_key, thumbnail_key
       FROM media
      WHERE owner_id = $1::uuid AND status <> 'deleted'`,
    [userId],
  );
  return rows.flatMap((r) => (r.thumbnail_key ? [r.storage_key, r.thumbnail_key] : [r.storage_key]));
}

/**
 * Per-user upload budget over a rolling window plus a lifetime byte ceiling
 * (EF §3.3: rate limiting is per-account, not only per-IP).
 *
 * Deleted media still counts toward the WINDOW — otherwise "upload, delete,
 * repeat" is an unlimited-bandwidth loop, which is exactly the abuse the window
 * exists to bound. It does not count toward the lifetime total, which measures
 * storage actually held.
 */
export async function quotaUsage(
  db: MediaDb,
  userId: string,
  windowHours: number,
): Promise<QuotaUsage> {
  const { rows } = await db.query<{ count: string; window_bytes: string; total_bytes: string }>(
    `SELECT
        count(*) FILTER (WHERE created_at > now() - make_interval(hours => $2::int))          AS count,
        coalesce(sum(byte_size) FILTER (
          WHERE created_at > now() - make_interval(hours => $2::int)), 0)                     AS window_bytes,
        coalesce(sum(byte_size) FILTER (WHERE status <> 'deleted'), 0)                        AS total_bytes
       FROM media
      WHERE owner_id = $1::uuid AND status <> 'failed'`,
    [userId, windowHours],
  );
  const row = rows[0];
  return {
    count: Number(row?.count ?? 0),
    window_bytes: Number(row?.window_bytes ?? 0),
    total_bytes: Number(row?.total_bytes ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Writes — `media` (this module's own table)
// ---------------------------------------------------------------------------

export interface InsertMediaInput {
  ownerId: string | null;
  uploadedBy: string | null;
  kind: MediaKind;
  storageKey: string;
  thumbnailKey: string | null;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  checksumSha256: string;
  status: MediaStatus;
}

export async function insertMedia(db: MediaDb, input: InsertMediaInput): Promise<MediaRow> {
  const { rows } = await db.query<RawMediaRow>(
    `INSERT INTO media (owner_id, uploaded_by, kind, storage_key, thumbnail_key,
                        mime_type, byte_size, width, height, checksum_sha256, status)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::bigint, $8::int, $9::int, $10, $11)
     RETURNING ${MEDIA_COLUMNS}`,
    [
      input.ownerId,
      input.uploadedBy,
      input.kind,
      input.storageKey,
      input.thumbnailKey,
      input.mimeType,
      input.byteSize,
      input.width,
      input.height,
      input.checksumSha256,
      input.status,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error('media insert returned no row');
  return toRow(row);
}

/**
 * Soft-deletes a media row.
 *
 * The row is KEPT (status 'deleted') rather than removed so that the deletion
 * is auditable and so a stale client link degrades to "image missing" instead
 * of a dangling id. Attachments are cleared in the same statement batch: a
 * public entity must never keep pointing at media whose bytes are gone.
 */
export async function softDeleteMedia(db: MediaDb, id: string): Promise<MediaRow | null> {
  await detachEverywhere(db, id);
  const { rows } = await db.query<RawMediaRow>(
    `UPDATE media
        SET status = 'deleted'
      WHERE id = $1::uuid AND status <> 'deleted'
      RETURNING ${MEDIA_COLUMNS}`,
    [id],
  );
  return rows[0] ? toRow(rows[0]) : null;
}

/** Marks a row failed — used when the object write fails after the insert. */
export async function markFailed(db: MediaDb, id: string): Promise<void> {
  await db.query(`UPDATE media SET status = 'failed' WHERE id = $1::uuid`, [id]);
}

// ---------------------------------------------------------------------------
// Writes — the four cross-module attachment columns (see the header)
// ---------------------------------------------------------------------------

/**
 * Points `users.avatar_media_id` at `mediaId` (or NULL) and returns the id it
 * replaced, so the caller can retire the old avatar.
 */
export async function setUserAvatar(
  db: MediaDb,
  userId: string,
  mediaId: string | null,
): Promise<{ found: boolean; previous_media_id: string | null }> {
  const { table, column } = ATTACHMENTS.user_avatar;
  const { rows } = await db.query<{ previous: string | null }>(
    swapSql(table, column),
    [userId, mediaId],
  );
  if (rows.length === 0) return { found: false, previous_media_id: null };
  return { found: true, previous_media_id: rows[0]?.previous ?? null };
}

/**
 * Points a catalog entity's image column at `mediaId` (or NULL) and returns the
 * id it replaced. `target` selects a fixed table/column pair from `ATTACHMENTS`
 * — a request can choose WHICH pair, never supply one.
 */
export async function setEntityImage(
  db: MediaDb,
  target: AttachTargetType,
  targetId: string,
  mediaId: string | null,
): Promise<{ found: boolean; previous_media_id: string | null }> {
  const { table, column } = attachmentOf(target);
  const { rows } = await db.query<{ previous: string | null }>(
    swapSql(table, column),
    [targetId, mediaId],
  );
  if (rows.length === 0) return { found: false, previous_media_id: null };
  return { found: true, previous_media_id: rows[0]?.previous ?? null };
}

/**
 * Clears every reference to `mediaId` across the attachment columns AND the
 * brewing photo column. Called on delete so nothing is left pointing at bytes
 * that no longer exist.
 *
 * `brew_sessions.photo_media_id` is written here — the one write this module
 * makes to a brewing-owned table, and the counterpart to the FK 0008 adds. The
 * alternative (leaving the reference and relying on the FK's ON DELETE SET NULL)
 * does not fire, because this is a SOFT delete: the row stays.
 */
export async function detachEverywhere(db: MediaDb, mediaId: string): Promise<void> {
  for (const key of Object.keys(ATTACHMENTS) as AttachmentKey[]) {
    const { table, column } = ATTACHMENTS[key];
    await db.query(`UPDATE ${table} SET ${column} = NULL WHERE ${column} = $1::uuid`, [mediaId]);
  }
  await db.query(`UPDATE brew_sessions SET photo_media_id = NULL WHERE photo_media_id = $1::uuid`, [
    mediaId,
  ]);
}

/** Does the target row exist? Used to answer 404 before attaching. */
export async function targetExists(
  db: MediaDb,
  target: AttachTargetType,
  targetId: string,
): Promise<boolean> {
  const { table } = attachmentOf(target);
  const { rows } = await db.query<{ ok: boolean }>(
    `SELECT true AS ok FROM ${table} WHERE id = $1::uuid`,
    [targetId],
  );
  return rows.length > 0;
}
