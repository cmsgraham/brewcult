/**
 * TOTP enrolment and management — backlog ID-07.
 *
 * Enrolment is two-step on purpose: `POST /mfa/enrol` stores an *unconfirmed*
 * secret, and only a correct code from the user's authenticator turns it on.
 * A one-step design locks people out of their own accounts when the QR scan
 * silently fails.
 *
 * Recovery codes are shown exactly once, at confirmation. They are stored
 * hashed, so this endpoint's response is the only copy the user will ever get.
 */
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../../lib/auth-plugin.js';
import { transaction } from '../../../lib/db.js';
import { badRequest, unauthorized } from '../../../lib/errors.js';
import { recordAuditEvent } from '../audit.js';
import { clientExec, poolExec } from '../context.js';
import { sendIdentityMail } from '../mailer.js';
import {
  RECOVERY_CODE_COUNT,
  TOTP_PERIOD_SECONDS,
  generateTotpSecret,
  totpUri,
  verifyTotp,
} from '../mfa.js';
import { verifyPassword } from '../passwords.js';
import {
  confirmMfa,
  deleteMfa,
  findUserById,
  findUserMfa,
  recordMfaTimeStep,
  replaceRecoveryCodes,
  upsertMfaEnrolment,
} from '../repo.js';
import {
  mfaConfirmSchema,
  mfaDisableSchema,
  mfaEnrolSchema,
  mfaRecoveryCodesSchema,
} from '../schemas.js';
import { generateRecoveryCode } from '../secrets.js';
import { csrfGuard } from './guards.js';

function freshRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => generateRecoveryCode());
}

export function registerMfaRoutes(app: FastifyInstance): void {
  app.post(
    '/mfa/enrol',
    { schema: mfaEnrolSchema, preHandler: [requireAuth, csrfGuard] },
    async (request, reply) => {
      const userId = request.actor.userId as string;
      const user = await findUserById(poolExec, userId);
      if (!user) throw unauthorized();

      const existing = await findUserMfa(poolExec, userId);
      if (existing?.confirmed_at) {
        throw badRequest('MFA is already enabled. Disable it before enrolling again.');
      }

      const secret = generateTotpSecret();
      await upsertMfaEnrolment(poolExec, userId, secret);
      await recordAuditEvent(poolExec, {
        actorId: userId,
        action: 'mfa.enrolment_started',
        targetType: 'user',
        targetId: userId,
      });

      return reply.send({
        secret,
        otpauth_url: totpUri(secret, user.email),
        digits: 6,
        period: TOTP_PERIOD_SECONDS,
      });
    },
  );

  app.post<{ Body: { code: string } }>(
    '/mfa/confirm',
    { schema: mfaConfirmSchema, preHandler: [requireAuth, csrfGuard] },
    async (request, reply) => {
      const userId = request.actor.userId as string;
      const user = await findUserById(poolExec, userId);
      const mfa = await findUserMfa(poolExec, userId);
      if (!user) throw unauthorized();
      if (!mfa) throw badRequest('Start enrolment first.');
      if (mfa.confirmed_at) throw badRequest('MFA is already enabled.');

      const result = await verifyTotp(mfa.secret, request.body.code, null);
      if (!result.valid) throw badRequest('That code is not valid.');

      const codes = freshRecoveryCodes();
      await transaction(async (client) => {
        const exec = clientExec(client);
        await confirmMfa(exec, userId, result.timeStep ?? 0);
        await replaceRecoveryCodes(exec, userId, codes);
        await recordAuditEvent(exec, {
          actorId: userId,
          action: 'mfa.enabled',
          targetType: 'user',
          targetId: userId,
          payload: { recovery_codes_issued: codes.length },
        });
      });

      await sendIdentityMail(request.log, {
        to: user.email,
        template: 'mfa_enabled',
        subject: 'Two-factor authentication is on for your BrewCult account',
        data: {},
      });

      return reply.send({
        status: 'enabled',
        // Sign in again to obtain a session whose access token carries mfa=true;
        // this one still says false, which is what `isStaff()` checks.
        recovery_codes: codes,
      });
    },
  );

  app.post<{ Body: { code: string } }>(
    '/mfa/recovery-codes',
    { schema: mfaRecoveryCodesSchema, preHandler: [requireAuth, csrfGuard] },
    async (request, reply) => {
      const userId = request.actor.userId as string;
      const mfa = await findUserMfa(poolExec, userId);
      if (!mfa?.confirmed_at) throw badRequest('MFA is not enabled.');

      const result = await verifyTotp(
        mfa.secret,
        request.body.code,
        mfa.last_time_step === null ? null : Number(mfa.last_time_step),
      );
      if (!result.valid) throw badRequest('That code is not valid.');

      const codes = freshRecoveryCodes();
      await transaction(async (client) => {
        const exec = clientExec(client);
        if (result.timeStep !== undefined) await recordMfaTimeStep(exec, userId, result.timeStep);
        await replaceRecoveryCodes(exec, userId, codes);
        await recordAuditEvent(exec, {
          actorId: userId,
          action: 'mfa.recovery_codes_regenerated',
          targetType: 'user',
          targetId: userId,
        });
      });

      return reply.send({ status: 'ok', recovery_codes: codes });
    },
  );

  app.post<{ Body: { password: string; code?: string } }>(
    '/mfa/disable',
    { schema: mfaDisableSchema, preHandler: [requireAuth, csrfGuard] },
    async (request, reply) => {
      const userId = request.actor.userId as string;
      const user = await findUserById(poolExec, userId);
      if (!user) throw unauthorized();

      // Turning MFA off is a downgrade of the account's own defences, so it
      // costs a password AND a live code — a hijacked session alone cannot do it.
      if (!(await verifyPassword(user.password_hash, request.body.password))) {
        throw unauthorized('Password is incorrect.');
      }
      const mfa = await findUserMfa(poolExec, userId);
      if (!mfa?.confirmed_at) throw badRequest('MFA is not enabled.');
      if (!request.body.code) throw badRequest('A current authenticator code is required.');

      const result = await verifyTotp(
        mfa.secret,
        request.body.code,
        mfa.last_time_step === null ? null : Number(mfa.last_time_step),
      );
      if (!result.valid) throw badRequest('That code is not valid.');

      await transaction(async (client) => {
        const exec = clientExec(client);
        await deleteMfa(exec, userId);
        await recordAuditEvent(exec, {
          actorId: userId,
          action: 'mfa.disabled',
          targetType: 'user',
          targetId: userId,
        });
      });

      await sendIdentityMail(request.log, {
        to: user.email,
        template: 'mfa_disabled',
        subject: 'Two-factor authentication was turned off',
        data: {},
      });

      return reply.send({ status: 'ok', message: 'Two-factor authentication disabled.' });
    },
  );
}
