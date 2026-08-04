/**
 * Profile routes — backlog ID-12 (conservative visibility defaults) and the
 * staff role-change surface (ID-08/ID-09).
 *
 * Every handler resolves (actor, action, resource) through `authorize()`; there
 * is not one `if (actor.userId === row.id)` in this file. What *is* decided
 * here is the projection: `toSelfProfile` for the subject and staff,
 * `toPublicProfile` for everyone else. New accounts therefore expose only
 * handle, display name, bio and creation date until the owner shares more.
 */
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../../lib/auth-plugin.js';
import { transaction } from '../../../lib/db.js';
import { badRequest, notFound, unauthorized } from '../../../lib/errors.js';
import { authorize, isStaff } from '../../../lib/policy.js';
import { recordAuditEvent } from '../audit.js';
import { clearSessionCookies } from '../cookies.js';
import { clientExec, poolExec } from '../context.js';
import { USER_RESOURCE } from '../policies.js';
import {
  findUserByHandle,
  findUserById,
  isMfaEnabled,
  listAuthIdentities,
  setUserRole,
  setUserStatus,
  toPublicProfile,
  toSelfProfile,
  toUserResource,
  updateProfile,
} from '../repo.js';
import {
  changeRoleSchema,
  deleteAccountSchema,
  getMeSchema,
  getProfileSchema,
  updateProfileSchema,
} from '../schemas.js';
import { revokeAllFamiliesForUser } from '../tokens.js';
import type { Role } from '../types.js';
import { csrfGuard } from './guards.js';

export function registerProfileRoutes(app: FastifyInstance): void {
  app.get('/me', { schema: getMeSchema, preHandler: requireAuth }, async (request, reply) => {
    const userId = request.actor.userId as string;
    const user = await findUserById(poolExec, userId);
    if (!user) throw unauthorized();
    await authorize(request.actor, 'read', USER_RESOURCE, toUserResource(user));
    const [mfaEnabled, identities] = await Promise.all([
      isMfaEnabled(poolExec, user.id),
      listAuthIdentities(poolExec, user.id),
    ]);
    return reply.send({ ...toSelfProfile(user, mfaEnabled), identities });
  });

  app.get<{ Params: { handle: string } }>(
    '/:handle',
    { schema: getProfileSchema },
    async (request, reply) => {
      const user = await findUserByHandle(poolExec, request.params.handle);
      if (!user || user.status === 'deleted') throw notFound('No such profile.');
      await authorize(request.actor, 'read', USER_RESOURCE, toUserResource(user));

      // The subject and staff see the full record; everyone else sees the
      // public projection.
      if (request.actor.userId === user.id || isStaff(request.actor)) {
        return reply.send(toSelfProfile(user, await isMfaEnabled(poolExec, user.id)));
      }
      return reply.send(toPublicProfile(user));
    },
  );

  app.patch<{ Params: { id: string }; Body: { display_name?: string; bio?: string } }>(
    '/:id',
    { schema: updateProfileSchema, preHandler: [requireAuth, csrfGuard] },
    async (request, reply) => {
      const target = await findUserById(poolExec, request.params.id);
      if (!target) throw notFound('No such profile.');
      // Cross-user updates die here, in the policy layer (IDOR defence, EF §3.2).
      await authorize(request.actor, 'update', USER_RESOURCE, toUserResource(target));

      const updated = await transaction(async (client) => {
        const exec = clientExec(client);
        const row = await updateProfile(exec, target.id, {
          display_name: request.body.display_name ?? null,
          bio: request.body.bio ?? null,
        });
        await recordAuditEvent(exec, {
          actorId: request.actor.userId,
          action: 'user.profile_updated',
          targetType: 'user',
          targetId: target.id,
          payload: { fields: Object.keys(request.body ?? {}) },
        });
        return row;
      });
      if (!updated) throw notFound('No such profile.');

      return reply.send(toSelfProfile(updated, await isMfaEnabled(poolExec, updated.id)));
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/:id',
    { schema: deleteAccountSchema, preHandler: [requireAuth, csrfGuard] },
    async (request, reply) => {
      const target = await findUserById(poolExec, request.params.id);
      if (!target) throw notFound('No such profile.');
      await authorize(request.actor, 'delete', USER_RESOURCE, toUserResource(target));

      // Deactivation, not deletion: erasure is a 30-day pipeline (EF §4.2/§4.3)
      // owned by the privacy lane. What this endpoint guarantees immediately is
      // that the account can no longer be used.
      await transaction(async (client) => {
        const exec = clientExec(client);
        await setUserStatus(exec, target.id, 'deactivated');
        const revoked = await revokeAllFamiliesForUser(exec, target.id);
        await recordAuditEvent(exec, {
          actorId: request.actor.userId,
          action: 'user.deactivated',
          targetType: 'user',
          targetId: target.id,
          payload: { sessions_revoked: revoked },
        });
      });

      clearSessionCookies(reply);
      return reply.send({
        status: 'ok',
        message: 'Account deactivated. Erasure completes within 30 days.',
      });
    },
  );

  app.patch<{ Params: { id: string }; Body: { role: Role; reason?: string } }>(
    '/:id/role',
    { schema: changeRoleSchema, preHandler: [requireAuth, csrfGuard] },
    async (request, reply) => {
      const target = await findUserById(poolExec, request.params.id);
      if (!target) throw notFound('No such profile.');
      // `moderate` requires isStaff(), which requires actor.mfa === true —
      // this is the MFA enforcement gate for staff roles (EF §2.3/§3.2).
      await authorize(request.actor, 'moderate', USER_RESOURCE, toUserResource(target));
      if (target.role === request.body.role) throw badRequest('That is already the role.');

      const updated = await transaction(async (client) => {
        const exec = clientExec(client);
        const row = await setUserRole(exec, target.id, request.body.role);
        // Permission-relevant change → append-only audit record (EF §3.7, ID-09).
        await recordAuditEvent(exec, {
          actorId: request.actor.userId,
          action: 'user.role_changed',
          targetType: 'user',
          targetId: target.id,
          payload: {
            from: target.role,
            to: request.body.role,
            reason: request.body.reason ?? null,
          },
        });
        // Roles are baked into access tokens, so the old ones must die.
        await revokeAllFamiliesForUser(exec, target.id);
        return row;
      });
      if (!updated) throw notFound('No such profile.');

      return reply.send(toSelfProfile(updated, await isMfaEnabled(poolExec, updated.id)));
    },
  );
}
