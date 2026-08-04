/**
 * Session management — backlog ID-06 ("log out other devices").
 *
 * A "session" is one refresh-token family. Revocation kills the family
 * immediately; the access token already in the client's hands keeps working
 * until it expires, which is why the access TTL is 15 minutes (ID-06's
 * acceptance criterion: "revocation takes effect ≤ access-token TTL").
 */
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../../lib/auth-plugin.js';
import { transaction } from '../../../lib/db.js';
import { notFound } from '../../../lib/errors.js';
import { authorize } from '../../../lib/policy.js';
import { recordAuditEvent } from '../audit.js';
import { clientExec, poolExec } from '../context.js';
import { SESSION_RESOURCE } from '../policies.js';
import { findSessionOwner, listSessions } from '../repo.js';
import {
  listSessionsSchema,
  revokeAllSessionsSchema,
  revokeSessionSchema,
} from '../schemas.js';
import { revokeAllFamiliesForUser, revokeFamily } from '../tokens.js';
import { csrfGuard } from './guards.js';

export function registerSessionRoutes(app: FastifyInstance): void {
  app.get(
    '/sessions',
    { schema: listSessionsSchema, preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.actor.userId as string;
      await authorize(request.actor, 'list', SESSION_RESOURCE);
      const sessions = await listSessions(poolExec, userId, request.sessionId);
      return reply.send({ sessions });
    },
  );

  app.delete<{ Params: { familyId: string } }>(
    '/sessions/:familyId',
    { schema: revokeSessionSchema, preHandler: [requireAuth, csrfGuard] },
    async (request, reply) => {
      const { familyId } = request.params;
      const owner = await findSessionOwner(poolExec, familyId);
      if (!owner) throw notFound('No such session.');

      // Ownership is decided by the policy layer, never by an inline compare.
      await authorize(request.actor, 'delete', SESSION_RESOURCE, {
        familyId,
        userId: owner,
      });

      await transaction(async (client) => {
        const exec = clientExec(client);
        const revoked = await revokeFamily(exec, familyId);
        await recordAuditEvent(exec, {
          actorId: request.actor.userId,
          action: 'auth.session_revoked',
          targetType: 'refresh_token_family',
          targetId: familyId,
          payload: { tokens_revoked: revoked },
        });
      });

      return reply.send({ status: 'ok', message: 'Session revoked.' });
    },
  );

  app.delete<{ Querystring: { keep_current?: boolean } }>(
    '/sessions',
    { schema: revokeAllSessionsSchema, preHandler: [requireAuth, csrfGuard] },
    async (request, reply) => {
      const userId = request.actor.userId as string;
      await authorize(request.actor, 'list', SESSION_RESOURCE);

      const keep = request.query.keep_current === true ? request.sessionId : null;

      const revoked = await transaction(async (client) => {
        const exec = clientExec(client);
        const count = await revokeAllFamiliesForUser(exec, userId, keep);
        await recordAuditEvent(exec, {
          actorId: userId,
          action: 'auth.all_sessions_revoked',
          targetType: 'user',
          targetId: userId,
          payload: { tokens_revoked: count, kept_family: keep },
        });
        return count;
      });

      return reply.send({ status: 'ok', message: `Revoked ${revoked} token(s).` });
    },
  );
}
