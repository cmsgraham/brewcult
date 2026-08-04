/**
 * TOTP multi-factor authentication — backlog ID-07, EF §2.3.
 *
 * RFC 6238 via otplib v13 (SHA-1 / 6 digits / 30s — the parameters every
 * authenticator app actually implements; a "stronger" choice here just breaks
 * Google Authenticator).
 *
 * Two anti-replay measures beyond plain verification:
 *  - a ±1 step tolerance (30 s each way) for clock skew, and no more;
 *  - `afterTimeStep`: a code is accepted at most once per user, because
 *    `user_mfa.last_time_step` advances on every success. Without it, a code
 *    shoulder-surfed or phished inside its 30-second window is replayable.
 *
 * `actor.mfa` (lib/policy.ts, `isStaff`) is true only for sessions that cleared
 * a challenge, which is what makes MFA *enforceable* for staff roles rather
 * than merely available.
 */
import { generate, generateSecret, generateURI, verify } from 'otplib';
import type { Role } from '../../lib/policy.js';

export const TOTP_PERIOD_SECONDS = 30;
/** ±1 period of clock skew. */
export const TOTP_TOLERANCE_SECONDS = TOTP_PERIOD_SECONDS;
export const RECOVERY_CODE_COUNT = 10;

/** Roles that must present MFA before staff powers apply (EF §2.3). */
export const MFA_REQUIRED_ROLES: readonly Role[] = ['moderator', 'editor', 'admin', 'seller_owner'];

/**
 * The enforcement hook the policy layer expects. `isStaff()` already refuses an
 * actor without `mfa === true`; this predicate answers the complementary
 * question a *route* asks: "should this user be told to finish enrolling?".
 */
export function mfaRequiredForRole(role: Role | null): boolean {
  return role !== null && MFA_REQUIRED_ROLES.includes(role);
}

export function generateTotpSecret(): string {
  return generateSecret({ length: 20 }); // 160-bit, RFC 4226 §4 R6
}

/** `otpauth://` URI for the QR code shown during enrolment. */
export function totpUri(secret: string, accountEmail: string, issuer = 'BrewCult'): string {
  return generateURI({
    strategy: 'totp',
    issuer,
    label: accountEmail,
    secret,
    period: TOTP_PERIOD_SECONDS,
  });
}

/** Current code for a secret — used by the test suite, not by request paths. */
export async function currentTotpToken(secret: string, epochSeconds?: number): Promise<string> {
  return generate({
    strategy: 'totp',
    secret,
    period: TOTP_PERIOD_SECONDS,
    ...(epochSeconds === undefined ? {} : { epoch: epochSeconds }),
  });
}

export interface TotpVerification {
  valid: boolean;
  /** Time step the code belongs to; persisted to block replay. */
  timeStep?: number;
}

export async function verifyTotp(
  secret: string,
  token: string,
  lastTimeStep: number | null,
): Promise<TotpVerification> {
  if (!/^\d{6}$/.test(token)) return { valid: false };
  const result = await verify({
    strategy: 'totp',
    secret,
    token,
    period: TOTP_PERIOD_SECONDS,
    epochTolerance: TOTP_TOLERANCE_SECONDS,
    ...(lastTimeStep === null ? {} : { afterTimeStep: lastTimeStep }),
  });
  if (!result.valid) return { valid: false };
  return { valid: true, timeStep: 'timeStep' in result ? result.timeStep : undefined };
}
