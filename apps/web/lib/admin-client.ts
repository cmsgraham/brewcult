/**
 * Operator-console API client (EF §3.2 — admin/moderator/editor surfaces).
 *
 * Everything here goes through `lib/api.ts#apiFetch`, which owns credentials,
 * the single 401 → refresh → retry dance and the friendly-error mapping. This
 * module adds three things on top and nothing else:
 *
 *  1. **Types for the admin contract** (Lane K, in flight). Field shapes follow
 *     the API's existing snake_case projections (`SelfUserProfile`,
 *     `login_attempts`, `audit_log`) so drift shows up as a type error rather
 *     than a blank cell.
 *  2. **`mfa_required` handling.** EF §3.2: staff actions live behind an MFA
 *     surface, and `isStaff()` in the API demands `actor.mfa === true`. The API
 *     may answer either `200 { mfa_required: true }` or a 403 with
 *     `error: "mfa_required"`. Both become {@link MfaRequiredError} so the UI can
 *     show the enrol prompt instead of a raw "forbidden".
 *  3. **Graceful degradation.** Lane K's routes may not be deployed. A 404/501
 *     is "not built yet", never a crash and never something that reads as the
 *     operator's mistake.
 *
 * ── Security note ────────────────────────────────────────────────────────────
 * Nothing in this module is a security control. The API's policy layer is the
 * only authority on who may do what; the role/MFA helpers below exist so the UI
 * can show the right screen, not to keep anyone out. See `gateFor`.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * P2 personal data (EF §4.1): emails and login artefacts pass through here.
 * They are never logged, never put in a query string, and never used as a route
 * key — user routes address people by opaque id.
 */
import {
  ApiError,
  apiFetch,
  isApiError,
  type ApiRequestOptions,
  type Paginated,
} from './api';

/* ------------------------------------------------------------------ *
 * Roles, statuses and the words we use for them
 * ------------------------------------------------------------------ */

export const ROLES = ['user', 'moderator', 'editor', 'seller_owner', 'admin'] as const;
export type AdminRole = (typeof ROLES)[number];

/** Mirrors `apps/api/src/lib/policy.ts#isStaff` — seller_owner is not staff. */
export const STAFF_ROLES: readonly AdminRole[] = ['moderator', 'editor', 'admin'];

export const USER_STATUSES = ['active', 'suspended', 'deactivated', 'deleted'] as const;
export type AdminUserStatus = (typeof USER_STATUSES)[number];

export const ROLE_LABEL: Record<AdminRole, string> = {
  user: 'Member',
  moderator: 'Moderator',
  editor: 'Editor',
  seller_owner: 'Seller owner',
  admin: 'Admin',
};

/** Plain-language consequence, shown in the change-role confirmation. */
export const ROLE_CONSEQUENCE: Record<AdminRole, string> = {
  user: 'Standard member access. No moderation tools, no catalogue editing, no seller dashboard.',
  moderator: 'Can work the moderation queue, act on reports and restrict accounts. Staff role — needs two-factor authentication.',
  editor: 'Can edit catalogue entries and published content. Staff role — needs two-factor authentication.',
  seller_owner: 'Grants access to the seller dashboard and listings. Two-factor authentication is required for this role.',
  admin: 'Full operator access, including creating and removing other admins. Staff role — needs two-factor authentication.',
};

export const STATUS_LABEL: Record<AdminUserStatus, string> = {
  active: 'Active',
  suspended: 'Suspended',
  deactivated: 'Deactivated',
  deleted: 'Deleted',
};

export function isStaffRole(role: AdminRole | null | undefined): boolean {
  return role != null && STAFF_ROLES.includes(role);
}

function asRole(value: unknown): AdminRole {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
    ? (value as AdminRole)
    : 'user';
}

function asStatus(value: unknown): AdminUserStatus {
  return typeof value === 'string' && (USER_STATUSES as readonly string[]).includes(value)
    ? (value as AdminUserStatus)
    : 'active';
}

/* ------------------------------------------------------------------ *
 * The signed-in operator
 * ------------------------------------------------------------------ */

export interface AdminActor {
  id: string;
  handle: string;
  email: string;
  displayName: string | null;
  role: AdminRole;
  status: AdminUserStatus;
  /** TOTP is enrolled on the account. */
  mfaEnrolled: boolean;
  /**
   * This *session* cleared an MFA challenge. That — not enrolment — is what the
   * API's `isStaff()` tests (`Actor.mfa`).
   *
   * ASSUMPTION (Lane K): `GET /api/me` grows a session-level `mfa` boolean. Until
   * it does, the only signal the endpoint exposes is `mfa_enabled`, so we fall
   * back to it. The fallback can only ever be *more* permissive than the API,
   * which is safe: the server still rejects the action, and the UI already
   * handles that as `mfa_required`.
   */
  mfaSession: boolean;
}

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const bool = (value: unknown): boolean => value === true;

/** Tolerant normaliser for `GET /api/me` — accepts snake_case or camelCase. */
export function normalizeActor(raw: unknown): AdminActor | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const id = str(record['id']);
  if (id === null) return null;

  const mfaEnrolled = bool(record['mfa_enabled'] ?? record['mfaEnabled']);
  const sessionMfa = record['mfa'] ?? record['session_mfa'] ?? record['mfaSession'];

  return {
    id,
    handle: str(record['handle']) ?? '',
    email: str(record['email']) ?? '',
    displayName: str(record['display_name'] ?? record['displayName']),
    role: asRole(record['role']),
    status: asStatus(record['status']),
    mfaEnrolled,
    mfaSession: typeof sessionMfa === 'boolean' ? sessionMfa : mfaEnrolled,
  };
}

/**
 * Mirror of the API's `isStaff()` (policy.ts): a staff role **and** an
 * MFA-backed session. Not a security check — see the module note.
 */
export function isStaff(actor: AdminActor | null | undefined): boolean {
  return actor != null && isStaffRole(actor.role) && actor.mfaSession === true;
}

/** Where an operator goes to turn two-factor on. */
export const MFA_SETUP_PATH = '/profile/security';

export type AdminGate =
  /** Signed out, or signed in without a staff role: the console does not exist. */
  | { state: 'unavailable' }
  /** Staff, but the session is not MFA-backed: enrol to continue. */
  | { state: 'mfa-required'; actor: AdminActor }
  | { state: 'ready'; actor: AdminActor };

/**
 * Which of the three console screens this actor should see.
 *
 * Note the deliberate collapse: "signed out" and "signed in but not staff" are
 * the *same* answer. Telling a member that an admin area exists but is closed to
 * them is an information leak with no upside.
 */
export function gateFor(actor: AdminActor | null | undefined): AdminGate {
  if (!actor || !isStaffRole(actor.role)) return { state: 'unavailable' };
  if (actor.mfaSession !== true) return { state: 'mfa-required', actor };
  return { state: 'ready', actor };
}

/* ------------------------------------------------------------------ *
 * Contract types (Lane K)
 * ------------------------------------------------------------------ */

export interface AdminUserSummary {
  id: string;
  handle: string;
  email: string;
  display_name?: string | null;
  role: AdminRole;
  status: AdminUserStatus;
  email_verified?: boolean;
  mfa_enabled?: boolean;
  last_seen_at?: string | null;
  created_at?: string;
  suspended_reason?: string | null;
}

/** One row of `login_attempts` (identity module), staff projection. */
export interface AdminLoginAttempt {
  id?: string;
  created_at: string;
  success: boolean;
  provider?: string | null;
  failure_reason?: string | null;
  ip?: string | null;
  user_agent?: string | null;
}

export interface AdminAuthIdentity {
  provider: string;
  created_at?: string | null;
}

export interface AdminUserDetail extends AdminUserSummary {
  bio?: string | null;
  identities?: AdminAuthIdentity[];
  recent_login_attempts?: AdminLoginAttempt[];
  session_count?: number;
  suspended_at?: string | null;
}

export const APPLICATION_STATUSES = ['pending', 'approved', 'rejected', 'withdrawn'] as const;
export type SellerApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const APPLICATION_STATUS_LABEL: Record<SellerApplicationStatus, string> = {
  pending: 'Waiting on us',
  approved: 'Approved',
  rejected: 'Declined',
  withdrawn: 'Withdrawn',
};

export interface SellerApplication {
  id: string;
  status: SellerApplicationStatus;
  business_name: string;
  created_at: string;
  applicant?: { id: string; handle: string; email?: string | null } | null;
  country?: string | null;
  website?: string | null;
  roaster_slug?: string | null;
  notes?: string | null;
  decision_reason?: string | null;
  decided_at?: string | null;
}

export const REPORT_STATUSES = ['open', 'reviewing', 'actioned', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  open: 'Open',
  reviewing: 'Being reviewed',
  actioned: 'Actioned',
  dismissed: 'Dismissed',
};

export interface ModerationReport {
  id: string;
  status: ReportStatus;
  reason: string;
  details?: string | null;
  target_type: string;
  target_id: string;
  target_url?: string | null;
  created_at: string;
  reporter?: { id: string; handle: string } | null;
  assignee?: { id: string; handle: string } | null;
  resolution?: string | null;
  resolution_note?: string | null;
  resolved_at?: string | null;
}

/** One append-only `audit_log` row (EF §3.7). */
export interface AuditEntry {
  id: string;
  created_at: string;
  action: string;
  actor_id?: string | null;
  actor_handle?: string | null;
  target_type?: string | null;
  target_id?: string | null;
  payload?: unknown;
}

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

/**
 * The action needs an MFA-backed session (EF §3.2). Its own type so callers
 * render the enrol prompt rather than a generic "you don't have access".
 */
export class MfaRequiredError extends Error {
  constructor(message = 'Staff actions need two-factor authentication.') {
    super(message);
    this.name = 'MfaRequiredError';
  }
}

export function isMfaRequiredError(value: unknown): value is MfaRequiredError {
  return value instanceof MfaRequiredError;
}

/** True when the endpoint simply is not deployed yet (Lane K in flight). */
export function isNotBuiltYet(error: unknown): boolean {
  return isApiError(error) && (error.status === 404 || error.status === 501);
}

const NOT_BUILT_COPY =
  'This part of the console is not switched on yet. Nothing is broken and nothing you did caused it — the endpoint ships with the operator API.';

/**
 * One line of copy for any failure. Never leaks a stack, a URL or a payload.
 * Callers handle {@link MfaRequiredError} before reaching here.
 */
export function describeAdminError(error: unknown, notBuiltCopy: string = NOT_BUILT_COPY): string {
  if (isMfaRequiredError(error)) return error.message;
  if (isNotBuiltYet(error)) return notBuiltCopy;
  if (isApiError(error)) return error.userMessage;
  return 'Something went wrong on our side, not yours. Try again in a moment.';
}

/* ------------------------------------------------------------------ *
 * Plumbing
 * ------------------------------------------------------------------ */

/**
 * The transport. Defaults to the browser `apiFetch`; server components pass
 * `serverApiFetch` (lib/server-api.ts) so cookies are forwarded on an RSC render.
 */
export type AdminFetch = <T>(path: string, options?: ApiRequestOptions) => Promise<T>;

const ADMIN_BASE = '/api/v1/admin';

/** Builds `?a=1&b=2`, dropping empties so the URL stays honest. */
export function queryString(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text === '') continue;
    search.set(key, text);
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}

/** A missing/odd envelope becomes an empty page rather than a crash. */
export function normalizePage<T>(raw: unknown): Paginated<T> {
  if (!raw || typeof raw !== 'object') return { items: [], next_cursor: null };
  const record = raw as Record<string, unknown>;
  const items = Array.isArray(record['items']) ? (record['items'] as T[]) : [];
  const cursor = record['next_cursor'];
  return { items, next_cursor: typeof cursor === 'string' && cursor !== '' ? cursor : null };
}

function mfaRequiredInBody(value: unknown): boolean {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as Record<string, unknown>)['mfa_required'] === true
  );
}

function mfaRequiredInError(error: unknown): boolean {
  if (!isApiError(error)) return false;
  if (error.code === 'mfa_required') return true;
  return error.status === 403 && mfaRequiredInBody(error.details);
}

/**
 * Run a staff mutation, translating both `mfa_required` shapes into
 * {@link MfaRequiredError}.
 */
async function staffMutation<T>(
  fetcher: AdminFetch,
  path: string,
  init: ApiRequestOptions,
): Promise<T> {
  let result: T;
  try {
    result = await fetcher<T>(path, init);
  } catch (error) {
    if (mfaRequiredInError(error)) throw new MfaRequiredError();
    throw error;
  }
  // A 200 that says "not without MFA" is still a refusal, not a success.
  if (mfaRequiredInBody(result)) throw new MfaRequiredError();
  return result;
}

export interface UserListParams {
  q?: string;
  role?: AdminRole | '';
  status?: AdminUserStatus | '';
  cursor?: string | null;
  limit?: number;
}

export interface AuditListParams {
  actor?: string;
  action?: string;
  target_type?: string;
  cursor?: string | null;
  limit?: number;
}

/** Result envelope shared by the mutating staff actions. */
export interface AdminActionResult {
  ok?: boolean;
  mfa_required?: boolean;
  user?: AdminUserSummary;
  [key: string]: unknown;
}

/**
 * Build a client bound to one transport.
 *
 * A factory rather than a module-level singleton because the two callers need
 * different transports: RSC renders must forward cookies explicitly, the browser
 * must not.
 */
export function createAdminClient(fetcher: AdminFetch = apiFetch) {
  const get = <T>(path: string, options?: ApiRequestOptions) => fetcher<T>(path, options);

  return {
    /** The signed-in operator, or null. Never throws — signed-out is normal. */
    async actor(options?: ApiRequestOptions): Promise<AdminActor | null> {
      try {
        // `/api/v1/users/me`. This read `/api/me`, which strips to `/me` and
        // 404s — the route lives under `/v1/users`. Combined with the catch
        // below turning every failure into "not signed in", the console could
        // never identify its operator: an account that had just been correctly
        // promoted to admin would still be refused at the gate, which looks
        // exactly like the permission not having been granted.
        return normalizeActor(await get<unknown>('/api/v1/users/me', options));
      } catch {
        return null;
      }
    },

    async listUsers(params: UserListParams = {}, options?: ApiRequestOptions) {
      const query = queryString({
        q: params.q ?? '',
        role: params.role ?? '',
        status: params.status ?? '',
        cursor: params.cursor ?? '',
        limit: params.limit ?? '',
      });
      return normalizePage<AdminUserSummary>(await get<unknown>(`${ADMIN_BASE}/users${query}`, options));
    },

    getUser: (id: string, options?: ApiRequestOptions) =>
      get<AdminUserDetail>(`${ADMIN_BASE}/users/${encodeURIComponent(id)}`, options),

    suspendUser: (id: string, reason: string, options?: ApiRequestOptions) =>
      staffMutation<AdminActionResult>(fetcher, `${ADMIN_BASE}/users/${encodeURIComponent(id)}/suspend`, {
        ...options,
        method: 'POST',
        body: { reason },
      }),

    reactivateUser: (id: string, options?: ApiRequestOptions) =>
      staffMutation<AdminActionResult>(fetcher, `${ADMIN_BASE}/users/${encodeURIComponent(id)}/reactivate`, {
        ...options,
        method: 'POST',
      }),

    forceLogout: (id: string, options?: ApiRequestOptions) =>
      staffMutation<AdminActionResult>(fetcher, `${ADMIN_BASE}/users/${encodeURIComponent(id)}/force-logout`, {
        ...options,
        method: 'POST',
      }),

    changeRole: (id: string, role: AdminRole, reason: string, options?: ApiRequestOptions) =>
      staffMutation<AdminActionResult>(fetcher, `${ADMIN_BASE}/users/${encodeURIComponent(id)}/role`, {
        ...options,
        method: 'PATCH',
        body: { role, reason },
      }),

    async listSellerApplications(
      params: { status?: SellerApplicationStatus | ''; cursor?: string | null } = {},
      options?: ApiRequestOptions,
    ) {
      const query = queryString({ status: params.status ?? '', cursor: params.cursor ?? '' });
      return normalizePage<SellerApplication>(
        await get<unknown>(`${ADMIN_BASE}/seller-applications${query}`, options),
      );
    },

    approveApplication: (id: string, note: string, options?: ApiRequestOptions) =>
      staffMutation<AdminActionResult>(
        fetcher,
        `${ADMIN_BASE}/seller-applications/${encodeURIComponent(id)}/approve`,
        { ...options, method: 'POST', body: { note } },
      ),

    rejectApplication: (id: string, reason: string, options?: ApiRequestOptions) =>
      staffMutation<AdminActionResult>(
        fetcher,
        `${ADMIN_BASE}/seller-applications/${encodeURIComponent(id)}/reject`,
        { ...options, method: 'POST', body: { reason } },
      ),

    async listReports(
      params: { status?: ReportStatus | ''; cursor?: string | null } = {},
      options?: ApiRequestOptions,
    ) {
      const query = queryString({ status: params.status ?? '', cursor: params.cursor ?? '' });
      return normalizePage<ModerationReport>(await get<unknown>(`${ADMIN_BASE}/reports${query}`, options));
    },

    claimReport: (id: string, options?: ApiRequestOptions) =>
      staffMutation<AdminActionResult>(fetcher, `${ADMIN_BASE}/reports/${encodeURIComponent(id)}/claim`, {
        ...options,
        method: 'POST',
      }),

    resolveReport: (
      id: string,
      input: { resolution: 'actioned' | 'dismissed'; note: string },
      options?: ApiRequestOptions,
    ) =>
      staffMutation<AdminActionResult>(fetcher, `${ADMIN_BASE}/reports/${encodeURIComponent(id)}/resolve`, {
        ...options,
        method: 'POST',
        body: input,
      }),

    async listAudit(params: AuditListParams = {}, options?: ApiRequestOptions) {
      const query = queryString({
        actor: params.actor ?? '',
        action: params.action ?? '',
        target_type: params.target_type ?? '',
        cursor: params.cursor ?? '',
        limit: params.limit ?? '',
      });
      return normalizePage<AuditEntry>(await get<unknown>(`${ADMIN_BASE}/audit${query}`, options));
    },
  };
}

export type AdminClient = ReturnType<typeof createAdminClient>;

/** Browser-side client. Server components build their own with `serverApiFetch`. */
export const adminClient: AdminClient = createAdminClient();

/**
 * `POST /api/v1/reports` — open to any authenticated user, not just staff. Lives
 * here because the shape is the moderation queue's input.
 */
export function submitReport(
  input: { target_type: string; target_id: string; reason: string; details?: string },
  options?: ApiRequestOptions,
): Promise<{ id?: string }> {
  return apiFetch<{ id?: string }>('/api/v1/reports', {
    ...options,
    method: 'POST',
    body: input,
  });
}

export { ApiError, isApiError };
export type { Paginated };
