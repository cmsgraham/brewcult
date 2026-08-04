/**
 * Token issuance and refresh-token FAMILY rotation — EF §2.3, backlog ID-03,
 * implementing the semantics documented in db/migrations/0002_identity.sql.
 *
 * The contract, restated because it is the security core of this lane:
 *
 *   * A login mints a new *family* (a random uuid) holding exactly one live
 *     refresh token.
 *   * A refresh marks the presented row `rotated_at = now()` and inserts a
 *     successor with the SAME `family_id`. There is never more than one live
 *     (rotated_at IS NULL AND revoked_at IS NULL) row in a family.
 *   * Presenting a token that already has `rotated_at` set means two parties
 *     hold tokens from one family — i.e. one of them stole it. The response is
 *     not "deny this request": it is REVOKE THE ENTIRE FAMILY, so the thief and
 *     the victim are both logged out and the victim's next refresh fails
 *     visibly. Silent denial would leave the thief's newer token alive.
 *
 * Tokens are 256-bit random values stored as SHA-256 only; the plaintext exists
 * solely in the response body/cookie.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  type AccessTokenPayload,
  type MfaChallengePayload,
} from '../../lib/auth-plugin.js';
import { unauthorized } from '../../lib/errors.js';
import type { Role } from '../../lib/policy.js';
import { recordAuditEvent } from './audit.js';
import { generateToken, hashToken } from './secrets.js';
import type { Exec, IssuedSession } from './types.js';

/** Refresh lifetime. A family that goes 30 days unused simply dies. */
export const REFRESH_TOKEN_TTL_DAYS = 30;
/** Window in which a password-verified user must answer the TOTP challenge. */
export const MFA_CHALLENGE_TTL_SECONDS = 5 * 60;

export interface RefreshTokenRow {
  id: string;
  user_id: string;
  family_id: string;
  expires_at: Date;
  rotated_at: Date | null;
  revoked_at: Date | null;
  mfa: boolean;
  expired: boolean;
}

export interface SessionContext {
  userAgent?: string | null;
  ip?: string | null;
}

/** Signs the 15-minute access JWT. `mfa` feeds `isStaff()` in the policy layer. */
export function signAccessToken(
  app: FastifyInstance,
  params: { userId: string; role: Role; mfa: boolean; familyId: string },
): string {
  const payload: AccessTokenPayload = {
    sub: params.userId,
    role: params.role,
    mfa: params.mfa,
    sid: params.familyId,
    typ: 'access',
  };
  return app.jwt.sign(payload, { expiresIn: ACCESS_TOKEN_TTL_SECONDS });
}

/**
 * Signs the intermediate token handed out between a correct password and a
 * correct TOTP code. A different `typ` means the actor decoder will not accept
 * it as authentication, so a half-finished login grants nothing.
 */
export function signMfaChallengeToken(app: FastifyInstance, userId: string): string {
  const payload: MfaChallengePayload = { sub: userId, typ: 'mfa_challenge' };
  return app.jwt.sign(payload, { expiresIn: MFA_CHALLENGE_TTL_SECONDS });
}

export function verifyMfaChallengeToken(app: FastifyInstance, token: string): string {
  let payload: MfaChallengePayload;
  try {
    payload = app.jwt.verify<MfaChallengePayload>(token);
  } catch {
    throw unauthorized('MFA challenge expired — start the sign-in again.');
  }
  if (payload.typ !== 'mfa_challenge' || typeof payload.sub !== 'string' || !payload.sub) {
    throw unauthorized('MFA challenge expired — start the sign-in again.');
  }
  return payload.sub;
}

/** Inserts a refresh token, creating a new family when `familyId` is omitted. */
export async function insertRefreshToken(
  exec: Exec,
  params: { userId: string; familyId?: string; mfa: boolean; context?: SessionContext },
): Promise<{ token: string; familyId: string; expiresAt: Date }> {
  const token = generateToken(32);
  const familyId = params.familyId ?? randomUUID();
  const { rows } = await exec<{ expires_at: Date }>(
    `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at, user_agent, ip, mfa)
     VALUES ($1, $2, $3, now() + ($4 || ' days')::interval, $5, $6::inet, $7)
     RETURNING expires_at`,
    [
      params.userId,
      familyId,
      hashToken(token),
      String(REFRESH_TOKEN_TTL_DAYS),
      params.context?.userAgent?.slice(0, 512) ?? null,
      params.context?.ip ?? null,
      params.mfa,
    ],
  );
  const expiresAt = rows[0]?.expires_at;
  if (!expiresAt) throw new Error('refresh token insert returned no row');
  return { token, familyId, expiresAt };
}

/** Mints a brand-new session (new family) for a freshly authenticated user. */
export async function issueSession(
  app: FastifyInstance,
  exec: Exec,
  params: { userId: string; role: Role; mfa: boolean; context?: SessionContext },
): Promise<IssuedSession> {
  const refresh = await insertRefreshToken(exec, {
    userId: params.userId,
    mfa: params.mfa,
    context: params.context,
  });
  return {
    accessToken: signAccessToken(app, {
      userId: params.userId,
      role: params.role,
      mfa: params.mfa,
      familyId: refresh.familyId,
    }),
    refreshToken: refresh.token,
    familyId: refresh.familyId,
    accessTokenExpiresIn: ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenExpiresAt: refresh.expiresAt,
  };
}

/** Revokes every non-revoked row of a family — one statement, per 0002's note. */
export async function revokeFamily(exec: Exec, familyId: string): Promise<number> {
  const { rows } = await exec<{ id: string }>(
    `UPDATE refresh_tokens
        SET revoked_at = now()
      WHERE family_id = $1 AND revoked_at IS NULL
      RETURNING id`,
    [familyId],
  );
  return rows.length;
}

/** Revokes every family belonging to a user ("log out everywhere"). */
export async function revokeAllFamiliesForUser(
  exec: Exec,
  userId: string,
  exceptFamilyId?: string | null,
): Promise<number> {
  const { rows } = await exec<{ id: string }>(
    `UPDATE refresh_tokens
        SET revoked_at = now()
      WHERE user_id = $1
        AND revoked_at IS NULL
        AND ($2::uuid IS NULL OR family_id <> $2::uuid)
      RETURNING id`,
    [userId, exceptFamilyId ?? null],
  );
  return rows.length;
}

/**
 * Result of presenting a refresh token.
 *
 * This is a RETURN VALUE and not an exception on purpose. Reuse detection
 * revokes the family, and that revocation has to be COMMITTED — but the request
 * itself fails. Throwing from inside the caller's transaction would roll the
 * revocation back with it, leaving the stolen family alive: the attacker would
 * simply keep using the token they already rotated to. Returning the outcome
 * lets the transaction commit and the caller answer 401 afterwards.
 */
export type RotationOutcome =
  | {
      status: 'rotated';
      userId: string;
      familyId: string;
      token: string;
      expiresAt: Date;
      /** MFA standing of the session, carried over from the presented token. */
      mfa: boolean;
    }
  | { status: 'reuse_detected'; userId: string; familyId: string }
  | { status: 'invalid' };

/**
 * The rotation step. Runs inside the caller's transaction so reuse detection
 * and family revocation cannot interleave with a concurrent refresh: the
 * presented row is taken `FOR UPDATE`, which serialises two clients racing with
 * the same token.
 *
 * Unknown, revoked and expired tokens all collapse to `invalid` — the caller
 * must not distinguish them to the client.
 */
export async function rotateRefreshToken(
  exec: Exec,
  presentedToken: string,
  context?: SessionContext,
): Promise<RotationOutcome> {
  const { rows } = await exec<RefreshTokenRow>(
    `SELECT id, user_id, family_id, expires_at, rotated_at, revoked_at, mfa,
            (expires_at <= now()) AS expired
       FROM refresh_tokens
      WHERE token_hash = $1
      FOR UPDATE`,
    [hashToken(presentedToken)],
  );

  const row = rows[0];
  if (!row) return { status: 'invalid' };

  if (row.rotated_at !== null) {
    // ---- THEFT SIGNAL -------------------------------------------------------
    // This token was already exchanged. Either the legitimate client replayed
    // an old token, or an attacker is using a stolen copy. We cannot tell them
    // apart, and the safe assumption is theft: kill the whole family.
    await revokeFamily(exec, row.family_id);
    await recordAuditEvent(exec, {
      actorId: row.user_id,
      action: 'auth.refresh_reuse_detected',
      targetType: 'refresh_token_family',
      targetId: row.family_id,
      payload: { reason: 'rotated_token_presented', ip: context?.ip ?? null },
    });
    await recordAuditEvent(exec, {
      actorId: null,
      action: 'auth.family_revoked',
      targetType: 'refresh_token_family',
      targetId: row.family_id,
      payload: { trigger: 'reuse_detection' },
    });
    return { status: 'reuse_detected', familyId: row.family_id, userId: row.user_id };
  }

  if (row.revoked_at !== null) return { status: 'invalid' };
  if (row.expired) return { status: 'invalid' };

  await exec(`UPDATE refresh_tokens SET rotated_at = now() WHERE id = $1`, [row.id]);

  const next = await insertRefreshToken(exec, {
    userId: row.user_id,
    familyId: row.family_id,
    // Carried over, never recomputed: a refresh can neither gain nor lose the
    // MFA standing the session was created with.
    mfa: row.mfa === true,
    context,
  });

  return {
    status: 'rotated',
    userId: row.user_id,
    familyId: row.family_id,
    token: next.token,
    expiresAt: next.expiresAt,
    mfa: row.mfa === true,
  };
}
