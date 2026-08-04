/**
 * Password authentication routes — DG §7.1, backlog ID-02/ID-03/ID-11.
 *
 * Anti-enumeration is a structural property of this file, not a comment:
 * `register`, `resend-verification` and `password/forgot` all end in the same
 * `accepted(reply)` call, and the branches that differ (send code vs. send
 * "someone tried to register") do the same amount of Argon2 work before they
 * diverge.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { REFRESH_COOKIE, requireAuth } from '../../../lib/auth-plugin.js';
import { transaction } from '../../../lib/db.js';
import { getEnv } from '../../../lib/env.js';
import { badRequest, conflict, unauthorized, tooManyRequests } from '../../../lib/errors.js';
import { recordAuditEvent } from '../audit.js';
import { clearSessionCookies, setSessionCookies } from '../cookies.js';
import { clientExec, poolExec, requestContext } from '../context.js';
import { checkLockout, recordLoginAttempt } from '../login-attempts.js';
import { sendIdentityMail } from '../mailer.js';
import { verifyTotp } from '../mfa.js';
import {
  burnPasswordVerify,
  checkPasswordPolicy,
  hashPassword,
  verifyPassword,
} from '../passwords.js';
import {
  VERIFICATION_MAX_ATTEMPTS,
  bumpVerificationAttempts,
  changeEmail,
  consumePasswordResetToken,
  consumeRecoveryCode,
  consumeVerificationCode,
  createPasswordResetToken,
  createUser,
  createVerificationCode,
  findLiveVerificationCode,
  findUserByEmail,
  findUserById,
  findUserMfa,
  handleExists,
  invalidatePasswordResetTokens,
  markEmailVerified,
  recordMfaTimeStep,
  setPasswordHash,
  touchLastSeen,
} from '../repo.js';
import {
  changePasswordSchema,
  confirmEmailChangeSchema,
  csrfTokenSchema,
  forgotPasswordSchema,
  loginSchema,
  logoutSchema,
  mfaLoginSchema,
  refreshSchema,
  registerSchema,
  requestEmailChangeSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '../schemas.js';
import {
  generateNumericCode,
  generateToken,
  hashToken,
  normaliseEmail,
  normaliseHandle,
  normaliseRecoveryCode,
} from '../secrets.js';
import {
  RefreshTokenReuseError,
  issueSession,
  revokeAllFamiliesForUser,
  revokeFamily,
  rotateRefreshToken,
  signAccessToken,
  signMfaChallengeToken,
  verifyMfaChallengeToken,
} from '../tokens.js';
import type { IssuedSession } from '../types.js';
import { csrfGuard } from './guards.js';

/** The one and only body returned by enumeration-sensitive endpoints. */
const ACCEPTED_BODY = {
  status: 'accepted',
  message:
    'If that email address can be used, we have sent a message with the next step. ' +
    'Check your inbox.',
} as const;

function accepted(reply: FastifyReply): FastifyReply {
  return reply.status(202).send(ACCEPTED_BODY);
}

function tokenResponse(session: IssuedSession): Record<string, unknown> {
  return {
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
    token_type: 'Bearer',
    expires_in: session.accessTokenExpiresIn,
    session_id: session.familyId,
  };
}

export function registerAuthRoutes(app: FastifyInstance): void {
  // --- CSRF token issuance ---------------------------------------------------
  app.get('/csrf', { schema: csrfTokenSchema }, async (request, reply) => {
    const token = reply.generateCsrf();
    return reply.send({ csrf_token: token, header: 'x-csrf-token' });
  });

  // --- registration ----------------------------------------------------------
  app.post<{ Body: { email: string; handle: string; password: string; display_name?: string } }>(
    '/register',
    { schema: registerSchema, preHandler: csrfGuard },
    async (request, reply) => {
      const email = normaliseEmail(request.body.email);
      const handle = normaliseHandle(request.body.handle);

      const policy = await checkPasswordPolicy(request.body.password, {
        email,
        handle,
        displayName: request.body.display_name ?? null,
      });
      if (!policy.ok) throw badRequest(policy.reason ?? 'Password rejected.');

      // Handles are public identifiers (a profile URL is /u/{handle}), so a
      // 409 here reveals nothing that the profile page does not. Emails are
      // NOT public, which is why the email branch below never 409s.
      if (await handleExists(poolExec, handle)) {
        throw conflict('That handle is already taken.', { field: 'handle' });
      }

      // Hash before branching so both paths pay the same Argon2id cost.
      const passwordHash = await hashPassword(request.body.password);
      const context = requestContext(request);

      const existing = await findUserByEmail(poolExec, email);
      if (existing) {
        await recordLoginAttempt(poolExec, {
          email,
          userId: existing.id,
          success: false,
          failureReason: 'duplicate_registration',
          ip: context.ip,
          userAgent: context.userAgent,
        });
        await sendIdentityMail(request.log, {
          to: email,
          template: 'duplicate_registration',
          subject: 'Someone tried to create a BrewCult account with your email',
          data: { app_url: getEnv().APP_URL },
        });
        return accepted(reply);
      }

      const code = generateNumericCode();
      await transaction(async (client) => {
        const exec = clientExec(client);
        const user = await createUser(exec, {
          email,
          handle,
          passwordHash,
          displayName: request.body.display_name ?? null,
        });
        await createVerificationCode(exec, { userId: user.id, code, purpose: 'signup' });
        await recordAuditEvent(exec, {
          actorId: user.id,
          action: 'user.registered',
          targetType: 'user',
          targetId: user.id,
          payload: { provider: 'email' },
        });
      });

      await sendIdentityMail(request.log, {
        to: email,
        template: 'verify_email',
        subject: 'Your BrewCult verification code',
        data: { code, expires_in_minutes: '15' },
        secretKeys: ['code'],
      });

      return accepted(reply);
    },
  );

  // --- email verification ----------------------------------------------------
  app.post<{ Body: { email: string; code: string } }>(
    '/verify-email',
    { schema: verifyEmailSchema, preHandler: csrfGuard },
    async (request, reply) => {
      const email = normaliseEmail(request.body.email);
      // Every failure below answers with this identical error, so a caller
      // cannot tell "no such account" from "wrong code" from "expired code".
      const invalid = () => badRequest('That code is not valid or has expired.');

      const user = await findUserByEmail(poolExec, email);
      if (!user) {
        await burnPasswordVerify();
        throw invalid();
      }

      const record = await findLiveVerificationCode(poolExec, user.id, 'signup');
      if (!record || record.expired) {
        await burnPasswordVerify();
        throw invalid();
      }
      if (record.attempts >= VERIFICATION_MAX_ATTEMPTS) {
        await consumeVerificationCode(poolExec, record.id);
        throw invalid();
      }

      const matches = await verifyPassword(record.code_hash, request.body.code);
      if (!matches) {
        await bumpVerificationAttempts(poolExec, record.id);
        throw invalid();
      }

      await transaction(async (client) => {
        const exec = clientExec(client);
        if (!(await consumeVerificationCode(exec, record.id))) throw invalid();
        await markEmailVerified(exec, user.id);
        await recordAuditEvent(exec, {
          actorId: user.id,
          action: 'user.email_verified',
          targetType: 'user',
          targetId: user.id,
        });
      });

      return reply.send({ status: 'verified', message: 'Your email address is confirmed.' });
    },
  );

  app.post<{ Body: { email: string } }>(
    '/verify-email/resend',
    { schema: resendVerificationSchema, preHandler: csrfGuard },
    async (request, reply) => {
      const email = normaliseEmail(request.body.email);
      const user = await findUserByEmail(poolExec, email);
      if (user && user.email_verified_at === null && user.status === 'active') {
        const code = generateNumericCode();
        await createVerificationCode(poolExec, { userId: user.id, code, purpose: 'signup' });
        await sendIdentityMail(request.log, {
          to: email,
          template: 'verify_email',
          subject: 'Your BrewCult verification code',
          data: { code, expires_in_minutes: '15' },
          secretKeys: ['code'],
        });
      }
      return accepted(reply);
    },
  );

  // --- login -----------------------------------------------------------------
  app.post<{ Body: { email: string; password: string } }>(
    '/login',
    { schema: loginSchema, preHandler: csrfGuard },
    async (request, reply) => {
      const email = normaliseEmail(request.body.email);
      const context = requestContext(request);
      const deny = () => unauthorized('Invalid email address or password.');

      // Lockout is keyed on the submitted address, so it throttles identically
      // for accounts that do and do not exist.
      const lockout = await checkLockout(poolExec, email);
      if (lockout.locked) {
        await recordLoginAttempt(poolExec, {
          email,
          success: false,
          failureReason: 'locked_out',
          ip: context.ip,
          userAgent: context.userAgent,
        });
        reply.header('retry-after', String(lockout.retryAfterSeconds));
        throw tooManyRequests('Too many attempts. Try again later.');
      }

      const user = await findUserByEmail(poolExec, email);
      if (!user || user.password_hash === null) {
        await burnPasswordVerify();
        await recordLoginAttempt(poolExec, {
          email,
          userId: user?.id ?? null,
          success: false,
          failureReason: user ? 'no_password_credential' : 'unknown_account',
          ip: context.ip,
          userAgent: context.userAgent,
        });
        throw deny();
      }

      if (!(await verifyPassword(user.password_hash, request.body.password))) {
        await recordLoginAttempt(poolExec, {
          email,
          userId: user.id,
          success: false,
          failureReason: 'bad_password',
          ip: context.ip,
          userAgent: context.userAgent,
        });
        throw deny();
      }

      if (user.status !== 'active') {
        await recordLoginAttempt(poolExec, {
          email,
          userId: user.id,
          success: false,
          failureReason: 'account_not_active',
          ip: context.ip,
          userAgent: context.userAgent,
        });
        throw deny();
      }

      // Past this point the caller has proved knowledge of the password, so
      // specific errors no longer leak anything they do not already know.
      if (user.email_verified_at === null) {
        await recordLoginAttempt(poolExec, {
          email,
          userId: user.id,
          success: false,
          failureReason: 'email_unverified',
          ip: context.ip,
          userAgent: context.userAgent,
        });
        throw badRequest('Confirm your email address before signing in.');
      }

      const mfa = await findUserMfa(poolExec, user.id);
      if (mfa?.confirmed_at) {
        await recordLoginAttempt(poolExec, {
          email,
          userId: user.id,
          success: false,
          failureReason: 'mfa_required',
          ip: context.ip,
          userAgent: context.userAgent,
        });
        return reply.send({
          mfa_required: true,
          mfa_token: signMfaChallengeToken(app, user.id),
        });
      }

      const session = await transaction(async (client) => {
        const exec = clientExec(client);
        const issued = await issueSession(app, exec, {
          userId: user.id,
          role: user.role,
          mfa: false,
          context,
        });
        await touchLastSeen(exec, user.id);
        await recordLoginAttempt(exec, {
          email,
          userId: user.id,
          success: true,
          ip: context.ip,
          userAgent: context.userAgent,
        });
        await recordAuditEvent(exec, {
          actorId: user.id,
          action: 'auth.login_succeeded',
          targetType: 'user',
          targetId: user.id,
          payload: { provider: 'email', family_id: issued.familyId },
        });
        return issued;
      });

      setSessionCookies(reply, session);
      return reply.send(tokenResponse(session));
    },
  );

  // --- MFA challenge (second leg of login) -----------------------------------
  app.post<{ Body: { mfa_token: string; code?: string; recovery_code?: string } }>(
    '/mfa/verify',
    { schema: mfaLoginSchema, preHandler: csrfGuard },
    async (request, reply) => {
      const context = requestContext(request);
      const userId = verifyMfaChallengeToken(app, request.body.mfa_token);
      const user = await findUserById(poolExec, userId);
      const mfa = user ? await findUserMfa(poolExec, user.id) : null;

      if (!user || user.status !== 'active' || !mfa?.confirmed_at) {
        throw unauthorized('MFA challenge expired — start the sign-in again.');
      }

      let usedRecoveryCode = false;
      let timeStep: number | undefined;

      if (request.body.code) {
        const result = await verifyTotp(
          mfa.secret,
          request.body.code,
          mfa.last_time_step === null ? null : Number(mfa.last_time_step),
        );
        if (!result.valid) {
          await failMfa(user.id, user.email, context);
          throw unauthorized('That code is not valid.');
        }
        timeStep = result.timeStep;
      } else if (request.body.recovery_code) {
        usedRecoveryCode = await consumeRecoveryCode(
          poolExec,
          user.id,
          normaliseRecoveryCode(request.body.recovery_code),
        );
        if (!usedRecoveryCode) {
          await failMfa(user.id, user.email, context);
          throw unauthorized('That code is not valid.');
        }
      } else {
        throw badRequest('Provide either code or recovery_code.');
      }

      const session = await transaction(async (client) => {
        const exec = clientExec(client);
        if (timeStep !== undefined) await recordMfaTimeStep(exec, user.id, timeStep);
        const issued = await issueSession(app, exec, {
          userId: user.id,
          role: user.role,
          mfa: true,
          context,
        });
        await touchLastSeen(exec, user.id);
        await recordLoginAttempt(exec, {
          email: user.email,
          userId: user.id,
          success: true,
          ip: context.ip,
          userAgent: context.userAgent,
        });
        await recordAuditEvent(exec, {
          actorId: user.id,
          action: 'auth.login_succeeded',
          targetType: 'user',
          targetId: user.id,
          payload: { provider: 'email', mfa: true, recovery_code: usedRecoveryCode },
        });
        if (usedRecoveryCode) {
          await recordAuditEvent(exec, {
            actorId: user.id,
            action: 'mfa.recovery_code_used',
            targetType: 'user',
            targetId: user.id,
          });
        }
        return issued;
      });

      setSessionCookies(reply, session);
      return reply.send(tokenResponse(session));
    },
  );

  async function failMfa(
    userId: string,
    email: string,
    context: { ip?: string | null; userAgent?: string | null },
  ): Promise<void> {
    await recordLoginAttempt(poolExec, {
      email,
      userId,
      success: false,
      failureReason: 'mfa_failed',
      ip: context.ip,
      userAgent: context.userAgent,
    });
  }

  // --- refresh rotation ------------------------------------------------------
  app.post<{ Body: { refresh_token?: string } }>(
    '/refresh',
    { schema: refreshSchema, preHandler: csrfGuard },
    async (request, reply) => {
      const presented = request.body?.refresh_token ?? request.cookies[REFRESH_COOKIE];
      if (!presented) throw unauthorized('No refresh token supplied.');
      const context = requestContext(request);

      let rotation;
      try {
        rotation = await transaction(async (client) =>
          rotateRefreshToken(clientExec(client), presented, context),
        );
      } catch (err) {
        if (err instanceof RefreshTokenReuseError) {
          // The family is already revoked (inside the transaction above).
          request.log.warn(
            { familyId: err.familyId, userId: err.userId },
            'refresh token reuse detected — family revoked',
          );
          await recordLoginAttempt(poolExec, {
            email: null,
            userId: err.userId,
            success: false,
            failureReason: 'refresh_reuse',
            ip: context.ip,
            userAgent: context.userAgent,
          });
          clearSessionCookies(reply);
          throw unauthorized('Session ended for security reasons. Sign in again.');
        }
        throw err;
      }

      const user = await findUserById(poolExec, rotation.userId);
      if (!user || user.status !== 'active') {
        await revokeFamily(poolExec, rotation.familyId);
        clearSessionCookies(reply);
        throw unauthorized('Session ended. Sign in again.');
      }

      // Refreshing preserves the MFA standing of the session it continues.
      const sessionMfa = request.actor.userId === user.id ? request.actor.mfa === true : false;
      const mfaEnabled = (await findUserMfa(poolExec, user.id))?.confirmed_at != null;

      const session: IssuedSession = {
        accessToken: signAccessToken(app, {
          userId: user.id,
          role: user.role,
          mfa: sessionMfa || mfaEnabled,
          familyId: rotation.familyId,
        }),
        refreshToken: rotation.token,
        familyId: rotation.familyId,
        accessTokenExpiresIn: 15 * 60,
        refreshTokenExpiresAt: rotation.expiresAt,
      };

      setSessionCookies(reply, session);
      return reply.send(tokenResponse(session));
    },
  );

  // --- logout ----------------------------------------------------------------
  app.post<{ Body: { refresh_token?: string } }>(
    '/logout',
    { schema: logoutSchema, preHandler: csrfGuard },
    async (request, reply) => {
      const presented = request.body?.refresh_token ?? request.cookies[REFRESH_COOKIE];
      if (presented) {
        await transaction(async (client) => {
          const exec = clientExec(client);
          const { rows } = await exec<{ family_id: string; user_id: string }>(
            `SELECT family_id, user_id FROM refresh_tokens WHERE token_hash = $1`,
            [hashToken(presented)],
          );
          const row = rows[0];
          if (!row) return;
          await revokeFamily(exec, row.family_id);
          await recordAuditEvent(exec, {
            actorId: row.user_id,
            action: 'auth.logout',
            targetType: 'refresh_token_family',
            targetId: row.family_id,
          });
        });
      }
      clearSessionCookies(reply);
      return reply.send({ status: 'ok', message: 'Signed out.' });
    },
  );

  // --- password reset --------------------------------------------------------
  app.post<{ Body: { email: string } }>(
    '/password/forgot',
    { schema: forgotPasswordSchema, preHandler: csrfGuard },
    async (request, reply) => {
      const email = normaliseEmail(request.body.email);
      const user = await findUserByEmail(poolExec, email);
      if (user && user.status === 'active') {
        const token = generateToken(32);
        await createPasswordResetToken(poolExec, user.id, token);
        await sendIdentityMail(request.log, {
          to: email,
          template: 'password_reset',
          subject: 'Reset your BrewCult password',
          data: {
            reset_url: `${getEnv().APP_URL}/reset-password?token=${encodeURIComponent(token)}`,
            expires_in_minutes: '60',
          },
          secretKeys: ['reset_url'],
        });
      }
      return accepted(reply);
    },
  );

  app.post<{ Body: { token: string; password: string } }>(
    '/password/reset',
    { schema: resetPasswordSchema, preHandler: csrfGuard },
    async (request, reply) => {
      const policy = await checkPasswordPolicy(request.body.password);
      if (!policy.ok) throw badRequest(policy.reason ?? 'Password rejected.');

      // Single-use: consumption and expiry are one atomic UPDATE, so replaying
      // a token (ID-11) finds nothing to consume.
      const consumed = await consumePasswordResetToken(poolExec, request.body.token);
      if (!consumed) throw badRequest('That reset link is not valid or has expired.');

      const passwordHash = await hashPassword(request.body.password);
      const user = await findUserById(poolExec, consumed.userId);

      await transaction(async (client) => {
        const exec = clientExec(client);
        await setPasswordHash(exec, consumed.userId, passwordHash);
        await invalidatePasswordResetTokens(exec, consumed.userId);
        // A password reset is also a compromise-recovery action: every existing
        // session dies with it.
        const revoked = await revokeAllFamiliesForUser(exec, consumed.userId);
        await recordAuditEvent(exec, {
          actorId: consumed.userId,
          action: 'user.password_reset_completed',
          targetType: 'user',
          targetId: consumed.userId,
          payload: { sessions_revoked: revoked },
        });
      });

      if (user) {
        await sendIdentityMail(request.log, {
          to: user.email,
          template: 'password_changed',
          subject: 'Your BrewCult password was changed',
          data: { app_url: getEnv().APP_URL },
        });
      }

      return reply.send({ status: 'ok', message: 'Your password has been changed.' });
    },
  );

  // --- authenticated credential management -----------------------------------
  app.post<{ Body: { current_password: string; new_password: string } }>(
    '/password/change',
    { schema: changePasswordSchema, preHandler: [requireAuth, csrfGuard] },
    async (request, reply) => {
      const actorId = request.actor.userId as string;
      const user = await findUserById(poolExec, actorId);
      if (!user) throw unauthorized();

      if (!(await verifyPassword(user.password_hash, request.body.current_password))) {
        throw unauthorized('Current password is incorrect.');
      }
      const policy = await checkPasswordPolicy(request.body.new_password, {
        email: user.email,
        handle: user.handle,
        displayName: user.display_name,
      });
      if (!policy.ok) throw badRequest(policy.reason ?? 'Password rejected.');

      const passwordHash = await hashPassword(request.body.new_password);
      await transaction(async (client) => {
        const exec = clientExec(client);
        await setPasswordHash(exec, user.id, passwordHash);
        await invalidatePasswordResetTokens(exec, user.id);
        // Changing a password logs every device out, including this one.
        const revoked = await revokeAllFamiliesForUser(exec, user.id);
        await recordAuditEvent(exec, {
          actorId: user.id,
          action: 'user.password_changed',
          targetType: 'user',
          targetId: user.id,
          payload: { sessions_revoked: revoked },
        });
      });

      await sendIdentityMail(request.log, {
        to: user.email,
        template: 'password_changed',
        subject: 'Your BrewCult password was changed',
        data: { app_url: getEnv().APP_URL },
      });

      clearSessionCookies(reply);
      return reply.send({ status: 'ok', message: 'Password changed. Please sign in again.' });
    },
  );

  // --- email change (ID-11) --------------------------------------------------
  app.post<{ Body: { new_email: string; current_password: string } }>(
    '/email/change',
    { schema: requestEmailChangeSchema, preHandler: [requireAuth, csrfGuard] },
    async (request, reply) => {
      const actorId = request.actor.userId as string;
      const user = await findUserById(poolExec, actorId);
      if (!user) throw unauthorized();
      if (!(await verifyPassword(user.password_hash, request.body.current_password))) {
        throw unauthorized('Current password is incorrect.');
      }

      const newEmail = normaliseEmail(request.body.new_email);
      if (newEmail === user.email) throw badRequest('That is already your email address.');

      // Existence of the target address is not revealed: the flow answers 202
      // either way and simply never issues a code for a taken address.
      const taken = await findUserByEmail(poolExec, newEmail);
      if (!taken) {
        const code = generateNumericCode();
        await createVerificationCode(poolExec, {
          userId: user.id,
          code,
          purpose: 'email_change',
          newEmail,
        });
        await recordAuditEvent(poolExec, {
          actorId: user.id,
          action: 'user.email_change_requested',
          targetType: 'user',
          targetId: user.id,
        });
        await sendIdentityMail(request.log, {
          to: newEmail,
          template: 'verify_email_change',
          subject: 'Confirm your new BrewCult email address',
          data: { code, expires_in_minutes: '15' },
          secretKeys: ['code'],
        });
        // The OLD address is always told (ID-11) — that is how a victim of a
        // session hijack finds out before losing the account.
        await sendIdentityMail(request.log, {
          to: user.email,
          template: 'email_changed_notice',
          subject: 'An email change was requested on your BrewCult account',
          data: { app_url: getEnv().APP_URL },
        });
      }
      return accepted(reply);
    },
  );

  app.post<{ Body: { code: string } }>(
    '/email/change/confirm',
    { schema: confirmEmailChangeSchema, preHandler: [requireAuth, csrfGuard] },
    async (request, reply) => {
      const actorId = request.actor.userId as string;
      const user = await findUserById(poolExec, actorId);
      if (!user) throw unauthorized();

      const invalid = () => badRequest('That code is not valid or has expired.');
      const record = await findLiveVerificationCode(poolExec, user.id, 'email_change');
      if (!record || record.expired || !record.new_email) throw invalid();
      if (record.attempts >= VERIFICATION_MAX_ATTEMPTS) {
        await consumeVerificationCode(poolExec, record.id);
        throw invalid();
      }
      if (!(await verifyPassword(record.code_hash, request.body.code))) {
        await bumpVerificationAttempts(poolExec, record.id);
        throw invalid();
      }

      const previousEmail = user.email;
      const newEmail = record.new_email;
      await transaction(async (client) => {
        const exec = clientExec(client);
        if (!(await consumeVerificationCode(exec, record.id))) throw invalid();
        await changeEmail(exec, user.id, newEmail);
        await recordAuditEvent(exec, {
          actorId: user.id,
          action: 'user.email_changed',
          targetType: 'user',
          targetId: user.id,
          payload: { from: previousEmail, to: newEmail },
        });
      });

      await sendIdentityMail(request.log, {
        to: previousEmail,
        template: 'email_changed_notice',
        subject: 'Your BrewCult email address was changed',
        data: { app_url: getEnv().APP_URL },
      });

      return reply.send({ status: 'ok', message: 'Email address updated.' });
    },
  );
}
