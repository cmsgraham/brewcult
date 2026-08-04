/**
 * Auth telemetry and account lockout — DG §7.1, EF §3.3, backlog ID-02.
 *
 * Every authentication attempt (email or OAuth, success or failure) lands in
 * `login_attempts`; the same table then drives lockout with exponential
 * backoff.
 *
 * Lockout is keyed on the *submitted email only*, never on IP:
 *  - keying on the submitted address means an attacker learns nothing from
 *    being throttled — an address with no account throttles identically to one
 *    with an account, so lockout is not an enumeration oracle;
 *  - per-IP and per-route limits belong to the central rate-limit middleware
 *    (EF §3.3), not here — doing it in this module would also lock out every
 *    user behind a single NAT.
 */
import type { Exec } from './types.js';

export type AttemptProvider = 'email' | 'google' | 'apple';

export type FailureReason =
  | 'unknown_account'
  | 'bad_password'
  | 'no_password_credential'
  | 'account_not_active'
  | 'email_unverified'
  | 'locked_out'
  | 'mfa_required'
  | 'mfa_failed'
  | 'refresh_reuse'
  | 'refresh_invalid'
  | 'provider_denied'
  | 'provider_email_unverified'
  | 'duplicate_registration';

export interface LoginAttempt {
  email: string | null;
  userId?: string | null;
  success: boolean;
  provider?: AttemptProvider;
  failureReason?: FailureReason | null;
  ip?: string | null;
  userAgent?: string | null;
}

export async function recordLoginAttempt(exec: Exec, attempt: LoginAttempt): Promise<void> {
  await exec(
    `INSERT INTO login_attempts (email, user_id, success, provider, failure_reason, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6::inet, $7)`,
    [
      attempt.email,
      attempt.userId ?? null,
      attempt.success,
      attempt.provider ?? 'email',
      attempt.failureReason ?? null,
      normaliseIp(attempt.ip),
      attempt.userAgent?.slice(0, 512) ?? null,
    ],
  );
}

/** `inet` rejects junk; an unparseable forwarded address must not 500 a login. */
function normaliseIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const trimmed = ip.trim();
  const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(trimmed);
  const isIpv6 = /^[0-9a-fA-F:]+$/.test(trimmed) && trimmed.includes(':');
  return isIpv4 || isIpv6 ? trimmed : null;
}

/** Consecutive failures tolerated before backoff starts. */
export const LOCKOUT_THRESHOLD = 5;
/** Failures older than this stop counting. */
export const LOCKOUT_WINDOW_MINUTES = 15;
const BASE_DELAY_SECONDS = 30;
const MAX_DELAY_SECONDS = 900;

/** 30s, 60s, 120s … capped at 15 minutes. */
export function backoffSeconds(failures: number): number {
  if (failures < LOCKOUT_THRESHOLD) return 0;
  const exponent = Math.min(failures - LOCKOUT_THRESHOLD, 10);
  return Math.min(BASE_DELAY_SECONDS * 2 ** exponent, MAX_DELAY_SECONDS);
}

export interface LockoutState {
  locked: boolean;
  failures: number;
  retryAfterSeconds: number;
}

/**
 * Counts failures for this email since its last success inside the window and
 * returns whether the caller must wait. A success clears the streak, which is
 * why the count is anchored to the most recent successful attempt.
 */
export async function checkLockout(exec: Exec, email: string): Promise<LockoutState> {
  const { rows } = await exec<{ failures: string; seconds_since: string | null }>(
    `WITH last_success AS (
       SELECT max(created_at) AS at
       FROM login_attempts
       WHERE email = $1 AND success = true
     )
     SELECT count(*)::text AS failures,
            EXTRACT(EPOCH FROM (now() - max(created_at)))::text AS seconds_since
     FROM login_attempts, last_success
     WHERE email = $1
       AND success = false
       AND created_at > now() - ($2 || ' minutes')::interval
       AND (last_success.at IS NULL OR created_at > last_success.at)`,
    [email, String(LOCKOUT_WINDOW_MINUTES)],
  );

  const failures = Number(rows[0]?.failures ?? 0);
  const secondsSince = rows[0]?.seconds_since == null ? Infinity : Number(rows[0].seconds_since);
  const required = backoffSeconds(failures);
  const remaining = Math.ceil(required - secondsSince);

  return {
    locked: remaining > 0,
    failures,
    retryAfterSeconds: remaining > 0 ? remaining : 0,
  };
}
