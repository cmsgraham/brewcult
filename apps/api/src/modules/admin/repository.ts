/**
 * Admin repository — the ONLY place in this module that writes SQL.
 *
 * Rules (EF §3.3, EF §1.2):
 *  - Parameterised queries only. User input never reaches the SQL string; it is
 *    collected by `Params` and bound as `$n`. The only strings concatenated into
 *    a statement are fixed, developer-authored fragments in this file.
 *  - Route handlers never see rows — they receive the DTOs from `./types.js`.
 *
 * ── TABLE OWNERSHIP: THE ONE DOCUMENTED EXCEPTION ───────────────────────────
 * This module OWNS `admin_seller_applications` and `reports` (0007) and reads
 * and writes them freely.
 *
 * It also READS five identity-owned tables — `users`, `auth_identities`,
 * `user_mfa`, `login_attempts` and `refresh_tokens` — because an operator
 * console is, definitionally, a cross-cutting read of the account graph, and
 * identity's public interface publishes only single-row lookups
 * (`findUserById`, `findUserByHandle`). There is no `listUsers` projection to
 * call, so `GET /v1/admin/users` cannot exist without this.
 *
 * The exception is bounded in three ways, and the boundary that matters is
 * kept intact:
 *   1. READ-ONLY. Every SELECT below against an identity table is a SELECT.
 *      There is not one UPDATE, INSERT or DELETE against `users`,
 *      `refresh_tokens` or any other identity table in this file — grep for it.
 *   2. Every WRITE goes through identity's published writers: `setUserRole()`
 *      and `setUserStatus()` for the account, `recordAuditEvent()` for the
 *      trail (via `./audit.ts`), and the injected revoker for refresh-token
 *      families (via `./sessions.ts`).
 *   3. The projection is declared once, in `ADMIN_USER_SELECT`, so the day
 *      identity publishes a proper `listUsersForAdmin()` there is exactly one
 *      query to delete.
 * This is recorded as a follow-up in the module README and the lane report: the
 * clean end state is identity owning the admin user projection.
 */

import { query as poolQuery, transaction as poolTransaction } from '../../lib/db.js';
import { conflict } from '../../lib/errors.js';
import { decodeCursor, paginate } from './cursor.js';
import type {
  AdminDb,
  AdminLoginAttempt,
  AdminUserDetail,
  AdminUserRow,
  AuditLogEntry,
  Exec,
  Page,
  Report,
  ReportReason,
  ReportStatus,
  ReportTargetType,
  Role,
  SellerApplication,
  SellerApplicationStatus,
  UserStatus,
} from './types.js';

// ---------------------------------------------------------------------------
// Seam plumbing
// ---------------------------------------------------------------------------

/** Default seam: the shared application pool. */
export const defaultAdminDb: AdminDb = {
  query: async <T>(text: string, params: readonly unknown[] = []) =>
    poolQuery(text, params) as unknown as Promise<{ rows: T[] }>,
  transaction: async <T>(fn: (tx: AdminDb) => Promise<T>): Promise<T> =>
    poolTransaction(async (client) =>
      fn({
        query: async <R>(text: string, params: readonly unknown[] = []) =>
          client.query(text, params as unknown[]) as unknown as Promise<{ rows: R[] }>,
      }),
    ),
};

/** Runs `fn` in a transaction when the seam supports one; inline otherwise. */
export function withTransaction<T>(db: AdminDb, fn: (tx: AdminDb) => Promise<T>): Promise<T> {
  return db.transaction ? db.transaction(fn) : fn(db);
}

/** Adapter for identity's published writers, which take a bare exec function. */
export const execOf =
  (db: AdminDb): Exec =>
  <T>(text: string, params?: readonly unknown[]) =>
    db.query<T>(text, params) as Promise<{ rows: T[] }>;

/** Ordered bind-parameter collector — nothing user-supplied is ever inlined. */
class Params {
  readonly values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

const toIso = (value: Date | string | null | undefined): string | null => {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
};

const toIsoRequired = (value: Date | string): string => toIso(value) ?? new Date(0).toISOString();

/**
 * Escapes LIKE metacharacters so a filter of `a%` matches a literal percent
 * rather than becoming a wildcard scan. Paired with `ESCAPE '\'` at every call
 * site below.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

interface PgErrorLike {
  code?: string;
  constraint?: string;
}

const pgErrorOf = (err: unknown): PgErrorLike =>
  typeof err === 'object' && err !== null ? (err as PgErrorLike) : {};

// ---------------------------------------------------------------------------
// Users (READ-ONLY — see the header note)
// ---------------------------------------------------------------------------

interface AdminUserDbRow {
  id: string;
  handle: string;
  email: string;
  display_name: string | null;
  role: Role;
  status: UserStatus;
  created_at: Date | string;
  updated_at: Date | string;
  last_seen_at: Date | string | null;
  email_verified_at: Date | string | null;
  has_password: boolean;
  mfa_enabled: boolean;
  /**
   * Comma-joined rather than a text[]: array decoding differs between the `pg`
   * driver and PGlite, and a projection that behaves differently in the test
   * suite than in production is a projection that is not really tested.
   */
  auth_providers: string | null;
}

/**
 * THE admin user projection. Declared once so there is a single query to remove
 * when identity publishes its own (see the header note on table ownership).
 */
const ADMIN_USER_SELECT = `
  SELECT u.id::text                                        AS id,
         u.handle::text                                    AS handle,
         u.email::text                                     AS email,
         u.display_name,
         u.role,
         u.status,
         u.created_at,
         u.updated_at,
         u.last_seen_at,
         u.email_verified_at,
         (u.password_hash IS NOT NULL)                     AS has_password,
         (m.confirmed_at IS NOT NULL)                      AS mfa_enabled,
         (SELECT string_agg(ai.provider, ',' ORDER BY ai.provider)
            FROM auth_identities ai
           WHERE ai.user_id = u.id)                        AS auth_providers
    FROM users u
    LEFT JOIN user_mfa m ON m.user_id = u.id`;

export function toAdminUser(row: AdminUserDbRow): AdminUserRow {
  return {
    id: row.id,
    handle: row.handle,
    email: row.email,
    display_name: row.display_name,
    role: row.role,
    status: row.status,
    created_at: toIsoRequired(row.created_at),
    updated_at: toIsoRequired(row.updated_at),
    last_seen_at: toIso(row.last_seen_at),
    email_verified_at: toIso(row.email_verified_at),
    mfa_enabled: row.mfa_enabled === true,
    has_password: row.has_password === true,
    auth_providers: row.auth_providers ? row.auth_providers.split(',') : [],
  };
}

export interface AdminUserFilters {
  /** Prefix match against email OR handle (both citext, so case-insensitive). */
  q?: string;
  role?: Role;
  status?: UserStatus;
  created_from?: string;
  created_to?: string;
  cursor?: string;
  limit: number;
}

export async function listUsers(db: AdminDb, filters: AdminUserFilters): Promise<Page<AdminUserRow>> {
  const p = new Params();
  const where: string[] = [];

  if (filters.q !== undefined && filters.q.trim().length > 0) {
    const prefix = p.add(`${escapeLike(filters.q.trim())}%`);
    where.push(`(u.email LIKE ${prefix} ESCAPE '\\' OR u.handle LIKE ${prefix} ESCAPE '\\')`);
  }
  if (filters.role !== undefined) where.push(`u.role = ${p.add(filters.role)}`);
  if (filters.status !== undefined) where.push(`u.status = ${p.add(filters.status)}`);
  if (filters.created_from !== undefined) {
    where.push(`u.created_at >= ${p.add(filters.created_from)}::timestamptz`);
  }
  if (filters.created_to !== undefined) {
    where.push(`u.created_at <= ${p.add(filters.created_to)}::timestamptz`);
  }
  if (filters.cursor !== undefined) {
    const key = decodeCursor(filters.cursor);
    where.push(
      `(u.created_at, u.id) < (${p.add(key.created_at)}::timestamptz, ${p.add(key.id)}::uuid)`,
    );
  }

  const res = await db.query<AdminUserDbRow>(
    `${ADMIN_USER_SELECT}
     ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY u.created_at DESC, u.id DESC
     LIMIT ${p.add(filters.limit + 1)}`,
    p.values,
  );

  const page = paginate(res.rows.map(toAdminUser), filters.limit);
  return { items: page.items, next_cursor: page.next_cursor };
}

export async function findAdminUserById(db: AdminDb, id: string): Promise<AdminUserRow | null> {
  const res = await db.query<AdminUserDbRow>(`${ADMIN_USER_SELECT} WHERE u.id = $1::uuid`, [id]);
  const row = res.rows[0];
  return row ? toAdminUser(row) : null;
}

/**
 * Lookup by email for the two bootstrap paths (ADMIN_EMAILS + the CLI).
 * `users.email` is citext, so this is case-insensitive without a lower() call
 * and without defeating the unique index.
 */
export async function findAdminUserByEmail(db: AdminDb, email: string): Promise<AdminUserRow | null> {
  const res = await db.query<AdminUserDbRow>(`${ADMIN_USER_SELECT} WHERE u.email = $1`, [email]);
  const row = res.rows[0];
  return row ? toAdminUser(row) : null;
}

export async function getUserDetail(db: AdminDb, id: string): Promise<AdminUserDetail | null> {
  const user = await findAdminUserById(db, id);
  if (!user) return null;

  const attempts = await db.query<{
    id: string;
    success: boolean;
    provider: string;
    failure_reason: string | null;
    ip: string | null;
    user_agent: string | null;
    created_at: Date | string;
  }>(
    `SELECT id::text AS id, success, provider, failure_reason,
            host(ip) AS ip, user_agent, created_at
       FROM login_attempts
      WHERE user_id = $1::uuid
      ORDER BY created_at DESC, id DESC
      LIMIT 20`,
    [id],
  );

  const sessions = await db.query<{ active: number; total: number }>(
    `SELECT (count(DISTINCT family_id) FILTER (WHERE revoked_at IS NULL AND expires_at > now()))::int AS active,
            (count(DISTINCT family_id))::int AS total
       FROM refresh_tokens
      WHERE user_id = $1::uuid`,
    [id],
  );

  const reports = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count
       FROM reports
      WHERE target_type = 'user' AND target_id = $1 AND status IN ('open','reviewing')`,
    [id],
  );

  const recent: AdminLoginAttempt[] = attempts.rows.map((row) => ({
    id: row.id,
    success: row.success,
    provider: row.provider,
    failure_reason: row.failure_reason,
    ip: row.ip,
    user_agent: row.user_agent,
    created_at: toIsoRequired(row.created_at),
  }));

  return {
    ...user,
    recent_login_attempts: recent,
    sessions: {
      active: sessions.rows[0]?.active ?? 0,
      total: sessions.rows[0]?.total ?? 0,
    },
    open_reports: reports.rows[0]?.count ?? 0,
  };
}

/**
 * Counts active admins, optionally ignoring one account.
 *
 * This is the lockout guard's only source of truth: "would this change leave
 * the platform with nobody who can undo it?". `excludeUserId` is the account
 * about to be demoted or suspended, so the answer is computed on the world as
 * it WOULD be, not as it is.
 */
export async function countActiveAdmins(db: AdminDb, excludeUserId?: string): Promise<number> {
  const res = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count
       FROM users
      WHERE role = 'admin'
        AND status = 'active'
        AND ($1::uuid IS NULL OR id <> $1::uuid)`,
    [excludeUserId ?? null],
  );
  return res.rows[0]?.count ?? 0;
}

/** Staff roster for `admin:list` (the CLI's read side). */
export async function listStaffUsers(db: AdminDb): Promise<AdminUserRow[]> {
  const res = await db.query<AdminUserDbRow>(
    `${ADMIN_USER_SELECT}
      WHERE u.role <> 'user'
      ORDER BY u.role, u.created_at`,
    [],
  );
  return res.rows.map(toAdminUser);
}

// ---------------------------------------------------------------------------
// Audit log (READ-ONLY by construction — the table refuses UPDATE/DELETE)
// ---------------------------------------------------------------------------

interface AuditDbRow {
  id: string;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  payload: Record<string, unknown> | string | null;
  created_at: Date | string;
}

function toAuditEntry(row: AuditDbRow): AuditLogEntry {
  let payload: Record<string, unknown> = {};
  if (typeof row.payload === 'string') {
    try {
      payload = JSON.parse(row.payload) as Record<string, unknown>;
    } catch {
      payload = {};
    }
  } else if (row.payload && typeof row.payload === 'object') {
    payload = row.payload;
  }
  return {
    id: row.id,
    actor_id: row.actor_id,
    action: row.action,
    target_type: row.target_type,
    target_id: row.target_id,
    payload,
    created_at: toIsoRequired(row.created_at),
  };
}

export interface AuditFilters {
  actor_id?: string;
  action?: string;
  target_type?: string;
  target_id?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit: number;
}

export async function listAuditLog(db: AdminDb, filters: AuditFilters): Promise<Page<AuditLogEntry>> {
  const p = new Params();
  const where: string[] = [];

  if (filters.actor_id !== undefined) where.push(`a.actor_id = ${p.add(filters.actor_id)}::uuid`);
  if (filters.action !== undefined) where.push(`a.action = ${p.add(filters.action)}`);
  if (filters.target_type !== undefined) {
    where.push(`a.target_type = ${p.add(filters.target_type)}`);
  }
  if (filters.target_id !== undefined) where.push(`a.target_id = ${p.add(filters.target_id)}`);
  if (filters.from !== undefined) where.push(`a.created_at >= ${p.add(filters.from)}::timestamptz`);
  if (filters.to !== undefined) where.push(`a.created_at <= ${p.add(filters.to)}::timestamptz`);
  if (filters.cursor !== undefined) {
    const key = decodeCursor(filters.cursor);
    where.push(
      `(a.created_at, a.id) < (${p.add(key.created_at)}::timestamptz, ${p.add(key.id)}::bigint)`,
    );
  }

  const res = await db.query<AuditDbRow>(
    `SELECT a.id::text AS id, a.actor_id::text AS actor_id, a.action,
            a.target_type, a.target_id, a.payload, a.created_at
       FROM audit_log a
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ${p.add(filters.limit + 1)}`,
    p.values,
  );

  const page = paginate(res.rows.map(toAuditEntry), filters.limit);
  return { items: page.items, next_cursor: page.next_cursor };
}

// ---------------------------------------------------------------------------
// Seller applications (owned by this module — 0007)
// ---------------------------------------------------------------------------

interface SellerApplicationDbRow {
  id: string;
  user_id: string;
  business_name: string;
  contact_email: string;
  notes: string | null;
  status: SellerApplicationStatus;
  reviewed_by: string | null;
  reviewed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const SELLER_APPLICATION_COLUMNS = `
  id::text AS id, user_id::text AS user_id, business_name,
  contact_email::text AS contact_email, notes, status,
  reviewed_by::text AS reviewed_by, reviewed_at, created_at, updated_at`;

function toSellerApplication(row: SellerApplicationDbRow): SellerApplication {
  return {
    id: row.id,
    user_id: row.user_id,
    business_name: row.business_name,
    contact_email: row.contact_email,
    notes: row.notes,
    status: row.status,
    reviewed_by: row.reviewed_by,
    reviewed_at: toIso(row.reviewed_at),
    created_at: toIsoRequired(row.created_at),
    updated_at: toIsoRequired(row.updated_at),
  };
}

export async function insertSellerApplication(
  db: AdminDb,
  input: { userId: string; businessName: string; contactEmail: string; notes: string | null },
): Promise<SellerApplication> {
  try {
    const res = await db.query<SellerApplicationDbRow>(
      `INSERT INTO admin_seller_applications (user_id, business_name, contact_email, notes)
       VALUES ($1::uuid, $2, $3, $4)
       RETURNING ${SELLER_APPLICATION_COLUMNS}`,
      [input.userId, input.businessName, input.contactEmail, input.notes],
    );
    const row = res.rows[0];
    if (!row) throw new Error('seller application insert returned no row');
    return toSellerApplication(row);
  } catch (err) {
    // uq_seller_applications_pending_per_user — the partial unique index is the
    // real gate; this only translates it into an honest status code.
    if (pgErrorOf(err).code === '23505') {
      throw conflict('You already have an application awaiting review.');
    }
    throw err;
  }
}

export interface SellerApplicationFilters {
  status?: SellerApplicationStatus;
  user_id?: string;
  cursor?: string;
  limit: number;
}

export async function listSellerApplications(
  db: AdminDb,
  filters: SellerApplicationFilters,
): Promise<Page<SellerApplication>> {
  const p = new Params();
  const where: string[] = [];

  if (filters.status !== undefined) where.push(`status = ${p.add(filters.status)}`);
  if (filters.user_id !== undefined) where.push(`user_id = ${p.add(filters.user_id)}::uuid`);
  if (filters.cursor !== undefined) {
    const key = decodeCursor(filters.cursor);
    where.push(
      `(created_at, id) < (${p.add(key.created_at)}::timestamptz, ${p.add(key.id)}::uuid)`,
    );
  }

  const res = await db.query<SellerApplicationDbRow>(
    `SELECT ${SELLER_APPLICATION_COLUMNS}
       FROM admin_seller_applications
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC, id DESC
      LIMIT ${p.add(filters.limit + 1)}`,
    p.values,
  );

  const page = paginate(res.rows.map(toSellerApplication), filters.limit);
  return { items: page.items, next_cursor: page.next_cursor };
}

export async function findSellerApplication(
  db: AdminDb,
  id: string,
): Promise<SellerApplication | null> {
  const res = await db.query<SellerApplicationDbRow>(
    `SELECT ${SELLER_APPLICATION_COLUMNS} FROM admin_seller_applications WHERE id = $1::uuid`,
    [id],
  );
  const row = res.rows[0];
  return row ? toSellerApplication(row) : null;
}

/**
 * Records the decision. The `status = 'pending'` predicate makes this a
 * compare-and-set: two moderators approving the same application concurrently
 * produce one decision and one 409, never two role grants and two audit rows.
 */
export async function decideSellerApplication(
  db: AdminDb,
  id: string,
  decision: 'approved' | 'rejected',
  reviewerId: string,
): Promise<SellerApplication | null> {
  const res = await db.query<SellerApplicationDbRow>(
    `UPDATE admin_seller_applications
        SET status = $2, reviewed_by = $3::uuid, reviewed_at = now()
      WHERE id = $1::uuid AND status = 'pending'
      RETURNING ${SELLER_APPLICATION_COLUMNS}`,
    [id, decision, reviewerId],
  );
  const row = res.rows[0];
  return row ? toSellerApplication(row) : null;
}

// ---------------------------------------------------------------------------
// Reports (owned by this module — 0007)
// ---------------------------------------------------------------------------

interface ReportDbRow {
  id: string;
  reporter_id: string;
  target_type: ReportTargetType;
  target_id: string;
  reason: ReportReason;
  detail: string | null;
  status: ReportStatus;
  resolution: string | null;
  reviewed_by: string | null;
  reviewed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const REPORT_COLUMNS = `
  id::text AS id, reporter_id::text AS reporter_id, target_type, target_id,
  reason, detail, status, resolution, reviewed_by::text AS reviewed_by,
  reviewed_at, created_at, updated_at`;

function toReport(row: ReportDbRow): Report {
  return {
    id: row.id,
    reporter_id: row.reporter_id,
    target_type: row.target_type,
    target_id: row.target_id,
    reason: row.reason,
    detail: row.detail,
    status: row.status,
    resolution: row.resolution,
    reviewed_by: row.reviewed_by,
    reviewed_at: toIso(row.reviewed_at),
    created_at: toIsoRequired(row.created_at),
    updated_at: toIsoRequired(row.updated_at),
  };
}

export async function insertReport(
  db: AdminDb,
  input: {
    reporterId: string;
    targetType: ReportTargetType;
    targetId: string;
    reason: ReportReason;
    detail: string | null;
  },
): Promise<Report> {
  try {
    const res = await db.query<ReportDbRow>(
      `INSERT INTO reports (reporter_id, target_type, target_id, reason, detail)
       VALUES ($1::uuid, $2, $3, $4, $5)
       RETURNING ${REPORT_COLUMNS}`,
      [input.reporterId, input.targetType, input.targetId, input.reason, input.detail],
    );
    const row = res.rows[0];
    if (!row) throw new Error('report insert returned no row');
    return toReport(row);
  } catch (err) {
    // uq_reports_live_per_reporter_target. Enforced in the database precisely so
    // two concurrent submissions cannot both pass an application-level check.
    if (pgErrorOf(err).code === '23505') {
      throw conflict('You already have an open report for this item.');
    }
    throw err;
  }
}

export interface ReportFilters {
  status?: ReportStatus;
  target_type?: ReportTargetType;
  target_id?: string;
  reporter_id?: string;
  cursor?: string;
  limit: number;
}

export async function listReports(db: AdminDb, filters: ReportFilters): Promise<Page<Report>> {
  const p = new Params();
  const where: string[] = [];

  if (filters.status !== undefined) where.push(`status = ${p.add(filters.status)}`);
  if (filters.target_type !== undefined) where.push(`target_type = ${p.add(filters.target_type)}`);
  if (filters.target_id !== undefined) where.push(`target_id = ${p.add(filters.target_id)}`);
  if (filters.reporter_id !== undefined) {
    where.push(`reporter_id = ${p.add(filters.reporter_id)}::uuid`);
  }
  if (filters.cursor !== undefined) {
    const key = decodeCursor(filters.cursor);
    where.push(
      `(created_at, id) < (${p.add(key.created_at)}::timestamptz, ${p.add(key.id)}::uuid)`,
    );
  }

  const res = await db.query<ReportDbRow>(
    `SELECT ${REPORT_COLUMNS}
       FROM reports
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC, id DESC
      LIMIT ${p.add(filters.limit + 1)}`,
    p.values,
  );

  const page = paginate(res.rows.map(toReport), filters.limit);
  return { items: page.items, next_cursor: page.next_cursor };
}

export async function findReport(db: AdminDb, id: string): Promise<Report | null> {
  const res = await db.query<ReportDbRow>(
    `SELECT ${REPORT_COLUMNS} FROM reports WHERE id = $1::uuid`,
    [id],
  );
  const row = res.rows[0];
  return row ? toReport(row) : null;
}

/** Compare-and-set claim: only an `open` report can be taken. */
export async function claimReport(
  db: AdminDb,
  id: string,
  moderatorId: string,
): Promise<Report | null> {
  const res = await db.query<ReportDbRow>(
    `UPDATE reports
        SET status = 'reviewing', reviewed_by = $2::uuid
      WHERE id = $1::uuid AND status = 'open'
      RETURNING ${REPORT_COLUMNS}`,
    [id, moderatorId],
  );
  const row = res.rows[0];
  return row ? toReport(row) : null;
}

/** Compare-and-set resolve: a terminal report cannot be re-decided. */
export async function resolveReport(
  db: AdminDb,
  id: string,
  outcome: 'actioned' | 'dismissed',
  resolution: string,
  moderatorId: string,
): Promise<Report | null> {
  const res = await db.query<ReportDbRow>(
    `UPDATE reports
        SET status = $2, resolution = $3, reviewed_by = $4::uuid, reviewed_at = now()
      WHERE id = $1::uuid AND status IN ('open','reviewing')
      RETURNING ${REPORT_COLUMNS}`,
    [id, outcome, resolution, moderatorId],
  );
  const row = res.rows[0];
  return row ? toReport(row) : null;
}
