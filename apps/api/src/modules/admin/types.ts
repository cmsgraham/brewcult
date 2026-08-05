/**
 * Admin module — shared types.
 *
 * Anything another lane (or the web admin console, via the generated client) is
 * allowed to depend on is re-exported from `index.ts`; dependency-cruiser
 * rejects imports of this file from outside the module (EF §1.2).
 */
import type { QueryResultRow } from 'pg';
import type { Role, UserStatus } from '../identity/index.js';

export type { Role, UserStatus };

// ---------------------------------------------------------------------------
// Database seam
// ---------------------------------------------------------------------------

export interface QueryResultLike<T> {
  rows: T[];
}

/**
 * The narrow slice of a Postgres client this module needs. Production wires the
 * shared pool (`lib/db.ts`); the test suite wires an in-process PGlite. Nothing
 * else about the driver is assumed.
 *
 * `transaction` is OPTIONAL so a seam that cannot nest (PGlite in the suite)
 * still works — `withTransaction` degrades to running the callback inline. The
 * operations that need atomicity say so at their call site.
 */
export interface AdminDb {
  query<T>(text: string, params?: readonly unknown[]): Promise<QueryResultLike<T>>;
  transaction?<T>(fn: (tx: AdminDb) => Promise<T>): Promise<T>;
}

/** Adapter shape identity's published writers take (`recordAuditEvent` et al). */
export type Exec = <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: readonly unknown[],
) => Promise<{ rows: T[] }>;

// ---------------------------------------------------------------------------
// Controlled vocabularies (mirrored by the CHECK constraints in 0007_admin.sql
// and by the JSON schemas in schemas.ts — three copies, one source of truth
// asserted by the test suite).
// ---------------------------------------------------------------------------

export const ASSIGNABLE_ROLES = ['user', 'moderator', 'editor', 'seller_owner', 'admin'] as const;

export const SELLER_APPLICATION_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type SellerApplicationStatus = (typeof SELLER_APPLICATION_STATUSES)[number];

export const REPORT_STATUSES = ['open', 'reviewing', 'actioned', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_TARGET_TYPES = [
  'user',
  'recipe',
  'brew_session',
  'coffee_product',
  'roaster',
  'equipment_model',
  'post',
  'comment',
  'review',
] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export const REPORT_REASONS = [
  'spam',
  'harassment',
  'hate_speech',
  'misinformation',
  'off_topic',
  'illegal',
  'impersonation',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

/**
 * The admin projection of a user. THIS IS P2 PERSONAL DATA (EF §4.1): it
 * carries the email address, the account's moderation state and its
 * authentication posture. It is returned only from staff-gated routes and it is
 * never merged into `toPublicProfile()`'s output — the public projection stays
 * conservative (ID-12) precisely so this one can be generous.
 */
export interface AdminUserRow {
  id: string;
  handle: string;
  email: string;
  display_name: string | null;
  role: Role;
  status: UserStatus;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
  email_verified_at: string | null;
  mfa_enabled: boolean;
  /** True when a password is set; false for OAuth-only accounts. */
  has_password: boolean;
  /** Linked third-party providers, e.g. `['google']`. */
  auth_providers: string[];
}

export interface AdminLoginAttempt {
  id: string;
  success: boolean;
  provider: string;
  failure_reason: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface AdminUserDetail extends AdminUserRow {
  /** Most recent authentication telemetry for this account (0002 login_attempts). */
  recent_login_attempts: AdminLoginAttempt[];
  sessions: {
    /** Refresh-token families that are neither revoked nor expired. */
    active: number;
    /** Every family ever issued to this account. */
    total: number;
  };
  /** Open + reviewing reports naming this user as the target. */
  open_reports: number;
}

export interface AuditLogEntry {
  id: string;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface SellerApplication {
  id: string;
  user_id: string;
  business_name: string;
  contact_email: string;
  notes: string | null;
  status: SellerApplicationStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Report {
  id: string;
  reporter_id: string;
  target_type: ReportTargetType;
  target_id: string;
  reason: ReportReason;
  detail: string | null;
  status: ReportStatus;
  resolution: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Keyset page envelope — the same shape catalog and brewing return. */
export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

// ---------------------------------------------------------------------------
// Policy resources
// ---------------------------------------------------------------------------

/** What the `admin_user` policy reasons about: the TARGET of the operation. */
export interface AdminUserResource {
  id: string;
  role: Role;
  status: UserStatus;
}

export interface SellerApplicationResource {
  id: string;
  user_id: string;
  status: SellerApplicationStatus;
}

export interface ReportResource {
  id: string;
  reporter_id: string;
  status: ReportStatus;
}

// ---------------------------------------------------------------------------
// Mutation results
// ---------------------------------------------------------------------------

export interface RoleChangeResult {
  user: AdminUserRow;
  previous_role: Role;
  /**
   * True when the new role is in MFA_REQUIRED_ROLES. The role is granted either
   * way — `isStaff()` refuses the actor until they enrol, so the grant is inert
   * rather than dangerous — but the console has to TELL them, or a freshly
   * promoted moderator sees 403s with no explanation.
   */
  mfa_required: boolean;
}

export interface StatusChangeResult {
  user: AdminUserRow;
  previous_status: UserStatus;
  /**
   * Refresh-token families revoked as part of the change, or `null` when no
   * session revoker is wired (see `sessions.ts` — the documented seam onto
   * identity). `null` is an operational warning, not a success.
   */
  sessions_revoked: number | null;
}
