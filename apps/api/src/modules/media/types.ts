/**
 * Media module — internal types and the database seam.
 *
 * Anything another lane (or the web client, via the generated client) may
 * depend on is re-exported from `index.ts`; dependency-cruiser rejects imports
 * of this file from outside the module (EF §1.2).
 */

import type { QueryResultRow } from 'pg';

// ---------------------------------------------------------------------------
// Database seam
// ---------------------------------------------------------------------------

export interface QueryResultLike<T> {
  rows: T[];
}

/**
 * The narrow slice of a Postgres client this module needs. Production wires the
 * shared pool (`lib/db.ts`); the test suite wires an in-process PGlite.
 *
 * `transaction` is OPTIONAL so a seam that cannot nest still works —
 * `withTransaction` degrades to running the callback inline.
 */
export interface MediaDb {
  query<T>(text: string, params?: readonly unknown[]): Promise<QueryResultLike<T>>;
  transaction?<T>(fn: (tx: MediaDb) => Promise<T>): Promise<T>;
}

/** Bare exec shape identity's published writers take (`recordAuditEvent`). */
export type Exec = <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: readonly unknown[],
) => Promise<{ rows: T[] }>;

/**
 * What `assertMediaUsable()` accepts from a calling module. Brewing holds a
 * `BrewingDb` (an object with `.query`), the identity writers hold a bare exec
 * function — both are accepted so no caller has to build an adapter.
 */
export type MediaExecutor = Exec | MediaDb;

// ---------------------------------------------------------------------------
// Controlled vocabularies — mirrored by the CHECK constraints in 0008_media.sql
// and by the JSON schemas in schemas.ts. The test suite asserts the copies agree.
// ---------------------------------------------------------------------------

export const MEDIA_KINDS = [
  'avatar',
  'brew_photo',
  'coffee_image',
  'equipment_image',
  'roaster_logo',
  /**
   * A photo attached to a catalogue SUGGESTION (0011/0012). Distinct from
   * `equipment_image` on purpose: that one is the picture on a public catalogue
   * page, platform-owned and staff-only to upload. This one is evidence for a
   * reviewer, owned by the person who sent it, and never published.
   */
  'equipment_submission',
] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/**
 * Kinds an ordinary authenticated user may upload for themselves. Everything
 * else is editorial: catalog imagery is platform content and goes through the
 * staff surface (`isStaff`, therefore MFA-gated).
 */
export const SELF_SERVE_KINDS = [
  'avatar',
  'brew_photo',
  'equipment_submission',
] as const satisfies readonly MediaKind[];

export const STAFF_KINDS = [
  'coffee_image',
  'equipment_image',
  'roaster_logo',
] as const satisfies readonly MediaKind[];

export const MEDIA_STATUSES = ['pending', 'ready', 'failed', 'deleted'] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

export const ATTACH_TARGET_TYPES = ['coffee_product', 'equipment_model', 'roaster'] as const;
export type AttachTargetType = (typeof ATTACH_TARGET_TYPES)[number];

/** Which media kind belongs on which catalog entity. */
export const KIND_FOR_TARGET: Record<AttachTargetType, MediaKind> = {
  coffee_product: 'coffee_image',
  equipment_model: 'equipment_image',
  roaster: 'roaster_logo',
};

// ---------------------------------------------------------------------------
// Rows and DTOs
// ---------------------------------------------------------------------------

/** A `media` row as the repository reads it. */
export interface MediaRow {
  id: string;
  owner_id: string | null;
  uploaded_by: string | null;
  kind: MediaKind;
  storage_key: string;
  thumbnail_key: string | null;
  mime_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  checksum_sha256: string;
  status: MediaStatus;
  created_at: string;
  updated_at: string;
}

/**
 * The shape the policy layer decides on. Deliberately minimal — a policy needs
 * ownership, status and whether the row hangs off a public entity, never the
 * whole row.
 */
export interface MediaResource {
  id: string;
  owner_id: string | null;
  status: MediaStatus;
  kind: MediaKind;
  /**
   * True when this media is currently attached to a P0-public entity (a catalog
   * row or a user avatar). Computed in SQL by the repository — a policy must
   * never issue its own query, and this is the one fact about the wider graph
   * the read decision needs.
   */
  public_attachment: boolean;
}

/** Public projection of a media row (what every endpoint returns). */
export interface MediaDto {
  id: string;
  kind: MediaKind;
  status: MediaStatus;
  mime_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  /** Absolute URL on the cookie-less media origin (EF §3.5, DG §5.3). */
  url: string;
  /** Absolute URL of the 400px derivative; null when none was produced. */
  thumbnail_url: string | null;
  owner_id: string | null;
  created_at: string;
}

/** Minimal reference other modules get back from `assertMediaUsable()`. */
export interface MediaRef {
  id: string;
  kind: MediaKind;
  owner_id: string | null;
  status: MediaStatus;
}

// ---------------------------------------------------------------------------
// Upload pipeline
// ---------------------------------------------------------------------------

/** One re-encoded rendition ready to be written to object storage. */
export interface Rendition {
  body: Buffer;
  contentType: string;
  width: number;
  height: number;
}

/** Everything the re-encoder produced from one upload. */
export interface ProcessedImage {
  original: Rendition;
  thumbnail: Rendition | null;
  /** What the magic bytes said the INPUT was (never the client's claim). */
  sniffedMime: string;
}

/** Per-user upload budget (EF §3.3 rate limiting, per-account class). */
export interface QuotaUsage {
  /** Uploads in the rolling window. */
  count: number;
  /** Bytes stored in the rolling window. */
  window_bytes: number;
  /** Bytes stored across all live media, all time. */
  total_bytes: number;
}
