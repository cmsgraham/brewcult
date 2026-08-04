/**
 * Identity data access. Every statement is parameterised (EF §3.3); there is no
 * string interpolation into SQL anywhere in this module.
 *
 * Only this module's own tables are touched: users, auth_identities,
 * refresh_tokens, login_attempts, audit_log (0002) and the identity extras
 * (see db/migrations/0005_identity_extras.sql).
 */
import type { Role } from '../../lib/policy.js';
import { hashPassword } from './passwords.js';
import { hashToken, normaliseHandle, normaliseRecoveryCode } from './secrets.js';
import type {
  AuthProvider,
  Exec,
  PublicUserProfile,
  SelfUserProfile,
  SessionSummary,
  UserResource,
  UserRow,
} from './types.js';

const USER_COLUMNS = `id, handle, email, password_hash, display_name, bio, status, role,
                      email_verified_at, last_seen_at, created_at, updated_at`;

// --- users -------------------------------------------------------------------

export async function findUserByEmail(exec: Exec, email: string): Promise<UserRow | null> {
  const { rows } = await exec<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE email = $1`,
    [email],
  );
  return rows[0] ?? null;
}

export async function findUserById(exec: Exec, id: string): Promise<UserRow | null> {
  const { rows } = await exec<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function findUserByHandle(exec: Exec, handle: string): Promise<UserRow | null> {
  const { rows } = await exec<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE handle = $1`, [
    normaliseHandle(handle),
  ]);
  return rows[0] ?? null;
}

export async function handleExists(exec: Exec, handle: string): Promise<boolean> {
  const { rows } = await exec<{ one: number }>(`SELECT 1 AS one FROM users WHERE handle = $1`, [
    normaliseHandle(handle),
  ]);
  return rows.length > 0;
}

export interface CreateUserParams {
  email: string;
  handle: string;
  passwordHash: string | null;
  displayName?: string | null;
  role?: Role;
  emailVerified?: boolean;
}

export async function createUser(exec: Exec, params: CreateUserParams): Promise<UserRow> {
  const { rows } = await exec<UserRow>(
    `INSERT INTO users (email, handle, password_hash, display_name, role, email_verified_at)
     VALUES ($1, $2, $3, $4, $5, CASE WHEN $6::boolean THEN now() ELSE NULL END)
     RETURNING ${USER_COLUMNS}`,
    [
      params.email,
      normaliseHandle(params.handle),
      params.passwordHash,
      params.displayName ?? null,
      params.role ?? 'user',
      params.emailVerified ?? false,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error('user insert returned no row');
  return row;
}

export async function markEmailVerified(exec: Exec, userId: string): Promise<void> {
  await exec(`UPDATE users SET email_verified_at = now() WHERE id = $1`, [userId]);
}

export async function setPasswordHash(exec: Exec, userId: string, hash: string): Promise<void> {
  await exec(`UPDATE users SET password_hash = $2 WHERE id = $1`, [userId, hash]);
}

export async function touchLastSeen(exec: Exec, userId: string): Promise<void> {
  await exec(`UPDATE users SET last_seen_at = now() WHERE id = $1`, [userId]);
}

export async function updateProfile(
  exec: Exec,
  userId: string,
  patch: { display_name?: string | null; bio?: string | null },
): Promise<UserRow | null> {
  const { rows } = await exec<UserRow>(
    `UPDATE users
        SET display_name = COALESCE($2, display_name),
            bio          = COALESCE($3, bio)
      WHERE id = $1
      RETURNING ${USER_COLUMNS}`,
    [userId, patch.display_name ?? null, patch.bio ?? null],
  );
  return rows[0] ?? null;
}

export async function setUserRole(exec: Exec, userId: string, role: Role): Promise<UserRow | null> {
  const { rows } = await exec<UserRow>(
    `UPDATE users SET role = $2 WHERE id = $1 RETURNING ${USER_COLUMNS}`,
    [userId, role],
  );
  return rows[0] ?? null;
}

export async function setUserStatus(
  exec: Exec,
  userId: string,
  status: UserRow['status'],
): Promise<UserRow | null> {
  const { rows } = await exec<UserRow>(
    `UPDATE users SET status = $2 WHERE id = $1 RETURNING ${USER_COLUMNS}`,
    [userId, status],
  );
  return rows[0] ?? null;
}

export async function changeEmail(exec: Exec, userId: string, email: string): Promise<void> {
  await exec(`UPDATE users SET email = $2, email_verified_at = now() WHERE id = $1`, [
    userId,
    email,
  ]);
}

// --- projections (ID-12: conservative by default) ----------------------------

export function toUserResource(user: UserRow): UserResource {
  return { id: user.id, status: user.status, role: user.role };
}

export function toPublicProfile(user: UserRow): PublicUserProfile {
  return {
    id: user.id,
    handle: user.handle,
    display_name: user.display_name,
    bio: user.bio,
    created_at: toIso(user.created_at) ?? new Date(0).toISOString(),
  };
}

export function toSelfProfile(user: UserRow, mfaEnabled: boolean): SelfUserProfile {
  return {
    ...toPublicProfile(user),
    email: user.email,
    role: user.role,
    status: user.status,
    email_verified: user.email_verified_at !== null,
    mfa_enabled: mfaEnabled,
    last_seen_at: toIso(user.last_seen_at),
  };
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

// --- auth_identities ---------------------------------------------------------

export interface AuthIdentityRow {
  id: string;
  user_id: string;
  provider: AuthProvider;
  provider_sub: string;
  email_at_link_time: string | null;
  created_at: Date;
}

export async function findAuthIdentity(
  exec: Exec,
  provider: AuthProvider,
  providerSub: string,
): Promise<AuthIdentityRow | null> {
  const { rows } = await exec<AuthIdentityRow>(
    `SELECT id, user_id, provider, provider_sub, email_at_link_time, created_at
       FROM auth_identities WHERE provider = $1 AND provider_sub = $2`,
    [provider, providerSub],
  );
  return rows[0] ?? null;
}

export async function listAuthIdentities(
  exec: Exec,
  userId: string,
): Promise<Array<{ provider: AuthProvider; created_at: string }>> {
  const { rows } = await exec<{ provider: AuthProvider; created_at: Date }>(
    `SELECT provider, created_at FROM auth_identities WHERE user_id = $1 ORDER BY created_at`,
    [userId],
  );
  return rows.map((row) => ({
    provider: row.provider,
    created_at: toIso(row.created_at) ?? new Date(0).toISOString(),
  }));
}

export async function linkAuthIdentity(
  exec: Exec,
  params: {
    userId: string;
    provider: AuthProvider;
    providerSub: string;
    emailAtLinkTime: string | null;
  },
): Promise<void> {
  await exec(
    `INSERT INTO auth_identities (user_id, provider, provider_sub, email_at_link_time)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (provider, provider_sub) DO NOTHING`,
    [params.userId, params.provider, params.providerSub, params.emailAtLinkTime],
  );
}

/**
 * Unlinking is refused when it would leave the account with no way in — an
 * OAuth-only user who unlinks their only provider is locked out permanently.
 */
export async function unlinkAuthIdentity(
  exec: Exec,
  userId: string,
  provider: AuthProvider,
): Promise<{ removed: boolean; reason?: 'last_credential' | 'not_linked' }> {
  const { rows: creds } = await exec<{ password_hash: string | null; identities: string }>(
    `SELECT u.password_hash,
            (SELECT count(*)::text FROM auth_identities ai WHERE ai.user_id = u.id) AS identities
       FROM users u WHERE u.id = $1`,
    [userId],
  );
  const cred = creds[0];
  if (!cred) return { removed: false, reason: 'not_linked' };
  if (cred.password_hash === null && Number(cred.identities) <= 1) {
    return { removed: false, reason: 'last_credential' };
  }
  const { rows } = await exec<{ id: string }>(
    `DELETE FROM auth_identities WHERE user_id = $1 AND provider = $2 RETURNING id`,
    [userId, provider],
  );
  return rows.length > 0 ? { removed: true } : { removed: false, reason: 'not_linked' };
}

// --- email verification codes ------------------------------------------------

export const VERIFICATION_CODE_TTL_MINUTES = 15;
export const VERIFICATION_MAX_ATTEMPTS = 5;

export interface VerificationCodeRow {
  id: string;
  user_id: string;
  purpose: 'signup' | 'email_change';
  new_email: string | null;
  code_hash: string;
  attempts: number;
  expired: boolean;
}

export async function createVerificationCode(
  exec: Exec,
  params: {
    userId: string;
    code: string;
    purpose: 'signup' | 'email_change';
    newEmail?: string | null;
  },
): Promise<void> {
  // Only one live code per (user, purpose): issuing a new one retires the old,
  // so an attacker cannot accumulate guesses across many outstanding codes.
  await exec(
    `UPDATE email_verification_codes
        SET consumed_at = now()
      WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
    [params.userId, params.purpose],
  );
  await exec(
    `INSERT INTO email_verification_codes (user_id, purpose, new_email, code_hash, expires_at)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' minutes')::interval)`,
    [
      params.userId,
      params.purpose,
      params.newEmail ?? null,
      await hashPassword(params.code),
      String(VERIFICATION_CODE_TTL_MINUTES),
    ],
  );
}

export async function findLiveVerificationCode(
  exec: Exec,
  userId: string,
  purpose: 'signup' | 'email_change',
): Promise<VerificationCodeRow | null> {
  const { rows } = await exec<VerificationCodeRow>(
    `SELECT id, user_id, purpose, new_email, code_hash, attempts,
            (expires_at <= now()) AS expired
       FROM email_verification_codes
      WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId, purpose],
  );
  return rows[0] ?? null;
}

export async function bumpVerificationAttempts(exec: Exec, id: string): Promise<number> {
  const { rows } = await exec<{ attempts: number }>(
    `UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts`,
    [id],
  );
  return rows[0]?.attempts ?? 0;
}

export async function consumeVerificationCode(exec: Exec, id: string): Promise<boolean> {
  const { rows } = await exec<{ id: string }>(
    `UPDATE email_verification_codes
        SET consumed_at = now()
      WHERE id = $1 AND consumed_at IS NULL
      RETURNING id`,
    [id],
  );
  return rows.length > 0;
}

// --- password reset tokens ---------------------------------------------------

export const RESET_TOKEN_TTL_MINUTES = 60;

export async function createPasswordResetToken(
  exec: Exec,
  userId: string,
  token: string,
): Promise<void> {
  await exec(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + ($3 || ' minutes')::interval)`,
    [userId, hashToken(token), String(RESET_TOKEN_TTL_MINUTES)],
  );
}

/**
 * Single-use consumption in one statement: the `consumed_at IS NULL` predicate
 * plus `RETURNING` means two concurrent redemptions of the same token can never
 * both succeed (ID-11 "token reuse fails").
 */
export async function consumePasswordResetToken(
  exec: Exec,
  token: string,
): Promise<{ userId: string } | null> {
  const { rows } = await exec<{ user_id: string }>(
    `UPDATE password_reset_tokens
        SET consumed_at = now()
      WHERE token_hash = $1
        AND consumed_at IS NULL
        AND expires_at > now()
      RETURNING user_id`,
    [hashToken(token)],
  );
  const row = rows[0];
  return row ? { userId: row.user_id } : null;
}

export async function invalidatePasswordResetTokens(exec: Exec, userId: string): Promise<void> {
  await exec(
    `UPDATE password_reset_tokens SET consumed_at = now()
      WHERE user_id = $1 AND consumed_at IS NULL`,
    [userId],
  );
}

// --- sessions (refresh-token families) --------------------------------------

export async function listSessions(
  exec: Exec,
  userId: string,
  currentFamilyId: string | null,
): Promise<SessionSummary[]> {
  const { rows } = await exec<{
    family_id: string;
    started_at: Date;
    last_used_at: Date;
    expires_at: Date;
    revoked: boolean;
    user_agent: string | null;
    ip: string | null;
  }>(
    `SELECT family_id,
            min(created_at) AS started_at,
            max(created_at) AS last_used_at,
            max(expires_at) AS expires_at,
            bool_or(revoked_at IS NOT NULL) AS revoked,
            (array_agg(user_agent ORDER BY created_at DESC))[1] AS user_agent,
            (array_agg(host(ip)   ORDER BY created_at DESC))[1] AS ip
       FROM refresh_tokens
      WHERE user_id = $1
      GROUP BY family_id
      ORDER BY max(created_at) DESC`,
    [userId],
  );

  return rows.map((row) => ({
    family_id: row.family_id,
    started_at: toIso(row.started_at) ?? '',
    last_used_at: toIso(row.last_used_at) ?? '',
    expires_at: toIso(row.expires_at) ?? '',
    revoked: row.revoked,
    current: currentFamilyId !== null && row.family_id === currentFamilyId,
    user_agent: row.user_agent,
    ip: row.ip,
  }));
}

export async function findSessionOwner(exec: Exec, familyId: string): Promise<string | null> {
  const { rows } = await exec<{ user_id: string }>(
    `SELECT user_id FROM refresh_tokens WHERE family_id = $1 LIMIT 1`,
    [familyId],
  );
  return rows[0]?.user_id ?? null;
}

// --- MFA ---------------------------------------------------------------------

export interface UserMfaRow {
  user_id: string;
  secret: string;
  confirmed_at: Date | null;
  last_time_step: string | null;
}

export async function findUserMfa(exec: Exec, userId: string): Promise<UserMfaRow | null> {
  const { rows } = await exec<UserMfaRow>(
    `SELECT user_id, secret, confirmed_at, last_time_step::text AS last_time_step
       FROM user_mfa WHERE user_id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function isMfaEnabled(exec: Exec, userId: string): Promise<boolean> {
  const { rows } = await exec<{ one: number }>(
    `SELECT 1 AS one FROM user_mfa WHERE user_id = $1 AND confirmed_at IS NOT NULL`,
    [userId],
  );
  return rows.length > 0;
}

/** Starting a new enrolment replaces any unconfirmed one and clears replay state. */
export async function upsertMfaEnrolment(exec: Exec, userId: string, secret: string): Promise<void> {
  await exec(
    `INSERT INTO user_mfa (user_id, secret, confirmed_at, last_time_step)
     VALUES ($1, $2, NULL, NULL)
     ON CONFLICT (user_id) DO UPDATE
        SET secret = EXCLUDED.secret, confirmed_at = NULL, last_time_step = NULL`,
    [userId, secret],
  );
}

export async function confirmMfa(exec: Exec, userId: string, timeStep: number): Promise<void> {
  await exec(
    `UPDATE user_mfa SET confirmed_at = now(), last_time_step = $2 WHERE user_id = $1`,
    [userId, String(timeStep)],
  );
}

export async function recordMfaTimeStep(
  exec: Exec,
  userId: string,
  timeStep: number,
): Promise<void> {
  await exec(
    `UPDATE user_mfa SET last_time_step = $2
      WHERE user_id = $1 AND (last_time_step IS NULL OR last_time_step < $2)`,
    [userId, String(timeStep)],
  );
}

export async function deleteMfa(exec: Exec, userId: string): Promise<void> {
  await exec(`DELETE FROM mfa_recovery_codes WHERE user_id = $1`, [userId]);
  await exec(`DELETE FROM user_mfa WHERE user_id = $1`, [userId]);
}

/**
 * Codes are hashed in their NORMALISED form (no dashes, upper case), which is
 * also the form `consumeRecoveryCode` looks up — so a user may type the code
 * with or without the display dashes and either works.
 */
export async function replaceRecoveryCodes(
  exec: Exec,
  userId: string,
  codes: readonly string[],
): Promise<void> {
  await exec(`DELETE FROM mfa_recovery_codes WHERE user_id = $1`, [userId]);
  for (const code of codes) {
    await exec(
      `INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES ($1, $2)
       ON CONFLICT (user_id, code_hash) DO NOTHING`,
      [userId, hashToken(normaliseRecoveryCode(code))],
    );
  }
}

/** Single-statement, single-use redemption — same pattern as the reset token. */
export async function consumeRecoveryCode(
  exec: Exec,
  userId: string,
  normalisedCode: string,
): Promise<boolean> {
  const { rows } = await exec<{ id: string }>(
    `UPDATE mfa_recovery_codes
        SET consumed_at = now()
      WHERE user_id = $1 AND code_hash = $2 AND consumed_at IS NULL
      RETURNING id`,
    [userId, hashToken(normalisedCode)],
  );
  return rows.length > 0;
}

export async function countUnusedRecoveryCodes(exec: Exec, userId: string): Promise<number> {
  const { rows } = await exec<{ count: string }>(
    `SELECT count(*)::text AS count FROM mfa_recovery_codes
      WHERE user_id = $1 AND consumed_at IS NULL`,
    [userId],
  );
  return Number(rows[0]?.count ?? 0);
}
