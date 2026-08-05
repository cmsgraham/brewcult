/**
 * Admin / operations HTTP surface (EF §3.2, §3.7, §3.8).
 *
 * Handlers do five things and nothing else: load the POLICY RESOURCE from the
 * database, resolve (actor, action, resource) through `authorize()`, enforce the
 * operation's own invariants, perform the mutation through identity's published
 * writers, and write the audit record. No SQL (that is `repository.ts`), no
 * ad-hoc validation (`schemas.ts`), no inline role comparisons for permission
 * (`policies.ts`).
 *
 * ── AUTHORIZE AGAINST THE STORED ROW, NEVER THE REQUEST ─────────────────────
 * Every `/v1/admin/users/:id/*` route loads the target account BEFORE
 * authorizing, and passes that row to `authorize()`. "May I suspend this
 * person?" depends on who they are, and the only trustworthy source of who they
 * are is the database.
 *
 * ── 401 vs 403 vs 409 ───────────────────────────────────────────────────────
 *   401  anonymous — `requireAuth` (the client can fix this by authenticating)
 *   403  authenticated but not staff, or staff without an MFA-backed session —
 *        `isStaff()` collapses those two into one answer on purpose
 *   409  entitled, but the operation would break an invariant: self-demotion,
 *        self-suspension, removing the last active admin, deciding an already
 *        decided application, claiming a claimed report. These are NOT
 *        authorization failures — telling an admin "forbidden" when the real
 *        answer is "you would lock yourself out" sends them hunting for a
 *        permission bug that does not exist.
 *
 * ── THE LOCKOUT GUARDS ──────────────────────────────────────────────────────
 * Three invariants, each of which has cost real platforms a real outage:
 *   1. An admin may not change their OWN role. (Fat-fingering `user` into your
 *      own role dropdown should not end the company's access to its console.)
 *   2. An admin may not suspend THEMSELVES.
 *   3. No change may leave ZERO active admins. Checked against the world as it
 *      WOULD be — `countActiveAdmins(db, targetId)` excludes the account being
 *      demoted or suspended — so the last admin cannot be removed by a peer
 *      either, not merely by themselves.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireAuth } from '../../lib/auth-plugin.js';
import { badRequest, conflict, notFound, unauthorized } from '../../lib/errors.js';
import { ANONYMOUS, authorize, type Actor } from '../../lib/policy.js';
import { csrfGuard, mfaRequiredForRole, setUserRole, setUserStatus } from '../identity/index.js';
import { recordAdminAudit } from './audit.js';
import {
  ADMIN_USER_RESOURCE,
  AUDIT_LOG_RESOURCE,
  REPORT_RESOURCE,
  SELLER_APPLICATION_RESOURCE,
} from './policies.js';
import { getEnv } from '../../lib/env.js';
import * as repo from './repository.js';
import {
  approveRequest,
  attachDraft,
  createEquipmentRequest,
  listMyRequests,
  listRequests,
  rejectRequest,
  type RequestStatus,
  findRequest,
} from './equipment-requests.js';
import { insertEquipmentModel, upsertEquipmentBrand } from '../catalog/index.js';
import { assertMediaUsable } from '../media/index.js';
import { draftEquipment } from '../intelligence/index.js';
import {
  AiGateway,
  AnthropicProvider,
  OpenAiProvider,
  defaultUsageStore,
} from '../intelligence/index.js';
import { EQUIPMENT_REQUEST_RESOURCE } from './policies.js';
import { defaultAdminDb, execOf, withTransaction } from './repository.js';
import {
  adminUserListQuery,
  auditListQuery,
  forceLogoutBody,
  idParams,
  reactivateBody,
  reportCreateBody,
  reportListQuery,
  reportResolveBody,
  roleChangeBody,
  sellerApplicationCreateBody,
  sellerApplicationDecisionBody,
  sellerApplicationListQuery,
  selfListQuery,
  suspendBody,
} from './schemas.js';
import { revokeAllSessions, setSessionRevoker, type SessionRevoker } from './sessions.js';
import type {
  AdminDb,
  AdminUserResource,
  AdminUserRow,
  ReportReason,
  ReportStatus,
  ReportTargetType,
  Role,
  SellerApplicationStatus,
  UserStatus,
} from './types.js';

export interface AdminRouteOptions {
  /** Database seam; defaults to the shared pool. Tests inject PGlite. */
  db?: AdminDb;
  /** Path prefix for every route in this module. */
  prefix?: string;
  /**
   * Refresh-token revoker. See `sessions.ts` — when omitted the module tries to
   * discover identity's `revokeAllFamiliesForUser` through its public interface
   * and, failing that, reports `sessions_revoked: null` rather than pretending.
   */
  revokeSessions?: SessionRevoker;
}

/**
 * Privilege ladder, used for ONE decision: is this role change a demotion?
 * A demotion revokes the target's sessions, because their live access token
 * still carries the old role claim for up to its 15-minute TTL and a demoted
 * admin should stop being an admin now, not in fifteen minutes.
 */
const ROLE_RANK: Record<Role, number> = {
  user: 0,
  seller_owner: 1,
  editor: 2,
  moderator: 3,
  admin: 4,
};

const isDemotion = (from: Role, to: Role): boolean => ROLE_RANK[to] < ROLE_RANK[from];

/** Reads the actor decorated by the auth plugin; anonymous when absent. */
function actorOf(request: FastifyRequest): Actor {
  return (request as FastifyRequest & { actor?: Actor }).actor ?? ANONYMOUS;
}

/**
 * The acting user's id. `requireAuth` has already answered 401 for anonymous
 * callers on every route that calls this; the throw is the type-level proof,
 * not a second gate.
 */
function actorIdOf(request: FastifyRequest): string {
  const id = actorOf(request).userId;
  if (id === null) throw unauthorized();
  return id;
}

const resourceOf = (user: AdminUserRow): AdminUserResource => ({
  id: user.id,
  role: user.role,
  status: user.status,
});

export async function registerAdminRoutes(
  app: FastifyInstance,
  options: AdminRouteOptions = {},
): Promise<void> {
  const db = options.db ?? defaultAdminDb;
  const prefix = options.prefix ?? '/v1';
  if (options.revokeSessions) setSessionRevoker(options.revokeSessions);

  /** Authenticated + CSRF-protected: every mutation on this surface. */
  const mutation = { preHandler: [requireAuth, csrfGuard] };
  /** Authenticated read (policy decides staff-ness). */
  const read = { preHandler: [requireAuth] };

  /**
   * Type-level staff gate, applied BEFORE any row is loaded.
   *
   * Without it the mutation routes leak an enumeration oracle: they load the
   * target first (they must — the policy decision depends on the stored row),
   * so a non-staff caller would get 404 for an id that does not exist and 403
   * for one that does. Two different answers to "does this id exist?" is
   * exactly the probe an attacker wants. Checking staff-ness first collapses
   * both to 403.
   */
  const staffGate = (request: FastifyRequest, resourceType: string, action: 'read' | 'moderate') =>
    authorize(actorOf(request), action, resourceType);

  // -------------------------------------------------------------------------
  // Equipment requests (0011, tier 2) — proposals for the shared catalogue.
  // -------------------------------------------------------------------------

  /**
   * Built lazily so an app with no AI configured still boots and still accepts
   * submissions — the drafting failure is recorded on the row rather than
   * rejecting somebody's typing.
   */
  let gateway: AiGateway | null = null;
  const getGateway = (): AiGateway => {
    gateway ??= new AiGateway({
      provider: getEnv().AI_PROVIDER === 'openai' ? new OpenAiProvider() : new AnthropicProvider(),
      usage: defaultUsageStore,
    });
    return gateway;
  };

  app.post<{ Body: { description?: string; image_media_id?: string } }>(
    `${prefix}/equipment-requests`,
    mutation,
    async (request, reply) => {
      const actor = actorOf(request);
      await authorize(actor, 'create', EQUIPMENT_REQUEST_RESOURCE);
      const userId = actor.userId;
      if (userId === null) throw badRequest('Authentication required.');

      const description = (request.body?.description ?? '').trim();
      if (description === '') throw badRequest('Tell us what the equipment is.');
      if (description.length > 4000) throw badRequest('That is a bit long — 4000 characters or fewer.');

      // Ownership of the photo is checked BEFORE the row is written: throwing
      // 403 here is honest, whereas storing the request and quietly dropping
      // somebody else's image would look like it worked. This is the IDOR that
      // `assertMediaUsable` exists to stop — a media id is guessable in a way a
      // photo's contents are not.
      const imageMediaId = request.body?.image_media_id ?? null;
      if (imageMediaId) {
        // 'equipment_submission', NOT 'equipment_image': the latter is the
        // picture on a public catalogue page, which is staff-only to upload.
        await assertMediaUsable(db, imageMediaId, userId, 'equipment_submission');
      }

      const created = await createEquipmentRequest(db, {
        requesterId: userId,
        submittedText: description,
        imageMediaId,
      });
      if (created.status === 'duplicate') {
        // Already queued. Impatience, not an error.
        return reply.status(200).send({ items: await listMyRequests(db, userId) });
      }

      // The draft is a convenience for the reviewer, so its failure must never
      // cost the submission that is already safely stored.
      try {
        const stored = await findRequest(db, created.id);
        const draft = await draftEquipment(
          actor,
          {
            description,
            // Our own media origin, never a URL the submitter chose.
            imageUrl: stored?.image_url ?? null,
          },
          { gateway: getGateway() },
        );
        await attachDraft(db, created.id, draft as unknown as Record<string, unknown>, null);
      } catch (err) {
        request.log.warn({ err, requestId: created.id }, 'equipment draft failed');
        await attachDraft(db, created.id, null, (err as Error).message.slice(0, 300));
      }

      return reply.status(201).send({ items: await listMyRequests(db, userId) });
    },
  );

  /** Your own submissions, so you can see what happened to them. */
  app.get(`${prefix}/equipment-requests`, read, async (request) => {
    const actor = actorOf(request);
    await authorize(actor, 'list', EQUIPMENT_REQUEST_RESOURCE);
    return { items: await listMyRequests(db, actor.userId!) };
  });

  /** The reviewer's queue. */
  app.get<{ Querystring: { status?: RequestStatus } }>(
    `${prefix}/admin/equipment-requests`,
    read,
    async (request) => {
      await staffGate(request, EQUIPMENT_REQUEST_RESOURCE, 'moderate');
      const status = request.query.status ?? 'pending';
      return { items: await listRequests(db, status) };
    },
  );

  app.post<{
    Params: { id: string };
    Body: {
      brand?: string;
      name?: string;
      category?: string;
      grind_scale_type?: string | null;
      specs?: Record<string, unknown> | null;
    };
  }>(`${prefix}/admin/equipment-requests/:id/approve`, mutation, async (request) => {
    await staffGate(request, EQUIPMENT_REQUEST_RESOURCE, 'moderate');
    const reviewerId = actorOf(request).userId;
    if (reviewerId === null) throw badRequest('Authentication required.');

    const body = request.body ?? {};
    // The reviewer's values, never ai_draft. Reading the draft here would make
    // the human a rubber stamp — the queue exists because somebody looked.
    if (!body.brand?.trim()) throw badRequest('A brand is required.');
    if (!body.name?.trim()) throw badRequest('A model name is required.');
    if (!body.category) throw badRequest('A category is required.');
    // The catalogue requires grinders to declare a scale (0003), because the
    // grind converter cannot answer without one. Catching it here gives the
    // reviewer the real reason; letting it reach the INSERT surfaces a
    // constraint name instead.
    if (body.category === 'grinder' && !body.grind_scale_type) {
      throw badRequest('Grinders need a grind scale: stepped, stepless or rotational.');
    }

    const result = await approveRequest(
      db,
      {
        id: request.params.id,
        reviewerId,
        brand: body.brand.trim(),
        name: body.name.trim(),
        category: body.category,
        grindScaleType: body.category === 'grinder' ? (body.grind_scale_type ?? null) : null,
        specs: body.specs ?? null,
      },
      {
        upsertBrand: (name) => upsertEquipmentBrand(db, name),
        insertModel: (row) => insertEquipmentModel(db, row as never) as never,
      },
    );

    if (result.status === 'not_found') throw notFound('Request not found.');
    if (result.status === 'already_decided') throw badRequest('That request was already decided.');
    if (result.status === 'conflict') throw badRequest(result.message);

    await recordAdminAudit(db, {
      actorId: reviewerId,
      action: 'admin.equipment_request_approved',
      targetType: 'equipment_request',
      targetId: request.params.id,
      payload: { equipment_model_id: result.equipmentModelId ?? null },
    });
    return { items: await listRequests(db, 'pending') };
  });

  app.post<{ Params: { id: string }; Body: { note?: string } }>(
    `${prefix}/admin/equipment-requests/:id/reject`,
    mutation,
    async (request) => {
      await staffGate(request, EQUIPMENT_REQUEST_RESOURCE, 'moderate');
      const reviewerId = actorOf(request).userId;
      if (reviewerId === null) throw badRequest('Authentication required.');

      const result = await rejectRequest(
        db,
        request.params.id,
        reviewerId,
        request.body?.note ?? '',
      );
      if (result.status === 'not_found') throw notFound('Request not found.');
      if (result.status === 'already_decided') throw badRequest('That request was already decided.');

      await recordAdminAudit(db, {
        actorId: reviewerId,
        action: 'admin.equipment_request_rejected',
        targetType: 'equipment_request',
        targetId: request.params.id,
        payload: {},
      });
      return { items: await listRequests(db, 'pending') };
    },
  );

  /**
   * Loads the target account or 404s. Deliberately the same 404 for "no such
   * id" as for a malformed-but-well-shaped uuid: the admin surface is already
   * staff-gated, so there is no enumeration concern, but there is also no
   * reason to have two code paths.
   */
  const loadUser = async (id: string): Promise<AdminUserRow> => {
    const user = await repo.findAdminUserById(db, id);
    if (!user) throw notFound('User not found.');
    return user;
  };

  /**
   * Refuses any change that would leave the platform with no active admin.
   * `targetId` is excluded from the count because the question is about the
   * world AFTER the change.
   */
  const assertAdminsRemain = async (target: AdminUserRow, what: string): Promise<void> => {
    if (target.role !== 'admin' || target.status !== 'active') return;
    const remaining = await repo.countActiveAdmins(db, target.id);
    if (remaining === 0) {
      throw conflict(
        `Refusing to ${what}: this is the last active admin, and the platform would be ` +
          'left with no one who can undo it. Promote another admin first.',
      );
    }
  };

  // =========================================================================
  // User administration
  // =========================================================================

  app.get<{
    Querystring: {
      q?: string;
      role?: Role;
      status?: UserStatus;
      created_from?: string;
      created_to?: string;
      cursor?: string;
      limit?: number;
    };
  }>(
    `${prefix}/admin/users`,
    { ...read, schema: { querystring: adminUserListQuery } },
    async (request) => {
      await authorize(actorOf(request), 'list', ADMIN_USER_RESOURCE);
      const q = request.query;
      return repo.listUsers(db, { ...q, limit: q.limit ?? 20 });
    },
  );

  app.get<{ Params: { id: string } }>(
    `${prefix}/admin/users/:id`,
    { ...read, schema: { params: idParams } },
    async (request) => {
      await authorize(actorOf(request), 'read', ADMIN_USER_RESOURCE);
      const detail = await repo.getUserDetail(db, request.params.id);
      if (!detail) throw notFound('User not found.');
      return detail;
    },
  );

  app.post<{ Params: { id: string }; Body: { reason: string } }>(
    `${prefix}/admin/users/:id/suspend`,
    { ...mutation, schema: { params: idParams, body: suspendBody } },
    async (request) => {
      const actorId = actorIdOf(request);
      await staffGate(request, ADMIN_USER_RESOURCE, 'read');
      const target = await loadUser(request.params.id);
      await authorize(actorOf(request), 'moderate', ADMIN_USER_RESOURCE, resourceOf(target));

      if (target.id === actorId) {
        throw conflict('You cannot suspend your own account.');
      }
      await assertAdminsRemain(target, 'suspend this account');

      return withTransaction(db, async (tx) => {
        const updated = await setUserStatus(execOf(tx), target.id, 'suspended');
        if (!updated) throw notFound('User not found.');

        // Defence in depth. `users.status` alone already stops login and
        // refresh (identity re-reads the row on both), but leaving the families
        // live would keep the operator's session view green and would silently
        // restore every old device on reactivation.
        const sessionsRevoked = await revokeAllSessions(tx, target.id);
        if (sessionsRevoked === null) {
          request.log.warn(
            { user_id: target.id },
            'suspended an account but no session revoker is wired — refresh-token ' +
              'families remain live (see modules/admin/sessions.ts)',
          );
        }

        await recordAdminAudit(tx, {
          actorId,
          action: 'admin.user_suspended',
          targetType: 'user',
          targetId: target.id,
          payload: {
            reason: request.body.reason,
            from_status: target.status,
            to_status: 'suspended',
            sessions_revoked: sessionsRevoked,
          },
        });

        return {
          user: { ...target, status: 'suspended' as UserStatus },
          previous_status: target.status,
          sessions_revoked: sessionsRevoked,
        };
      });
    },
  );

  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    `${prefix}/admin/users/:id/reactivate`,
    { ...mutation, schema: { params: idParams, body: reactivateBody } },
    async (request) => {
      const actorId = actorIdOf(request);
      await staffGate(request, ADMIN_USER_RESOURCE, 'read');
      const target = await loadUser(request.params.id);
      await authorize(actorOf(request), 'moderate', ADMIN_USER_RESOURCE, resourceOf(target));

      // 'deleted' is a terminal state under EF §4.3 (hard-delete within 30
      // days, public content anonymised). Resurrecting one through the admin
      // console would contradict what the user was told at deletion time.
      if (target.status === 'deleted') {
        throw conflict('A deleted account cannot be reactivated.');
      }

      return withTransaction(db, async (tx) => {
        const updated = await setUserStatus(execOf(tx), target.id, 'active');
        if (!updated) throw notFound('User not found.');

        await recordAdminAudit(tx, {
          actorId,
          action: 'admin.user_reactivated',
          targetType: 'user',
          targetId: target.id,
          payload: {
            ...(request.body?.reason !== undefined ? { reason: request.body.reason } : {}),
            from_status: target.status,
            to_status: 'active',
          },
        });

        return {
          user: { ...target, status: 'active' as UserStatus },
          previous_status: target.status,
          // Reactivation deliberately does NOT restore sessions: they were
          // revoked on suspension and the user logs in again, which is an
          // observable event rather than a silent resumption.
          sessions_revoked: 0,
        };
      });
    },
  );

  app.patch<{ Params: { id: string }; Body: { role: Role; reason?: string } }>(
    `${prefix}/admin/users/:id/role`,
    { ...mutation, schema: { params: idParams, body: roleChangeBody } },
    async (request) => {
      const actorId = actorIdOf(request);
      await staffGate(request, ADMIN_USER_RESOURCE, 'read');
      const target = await loadUser(request.params.id);
      // 'update' on admin_user is the narrow gate: admins only (policies.ts).
      await authorize(actorOf(request), 'update', ADMIN_USER_RESOURCE, resourceOf(target));

      const nextRole = request.body.role;

      if (target.id === actorId) {
        throw conflict(
          'You cannot change your own role. Ask another admin — this is what stops one ' +
            'mistaken dropdown from ending your access.',
        );
      }
      if (isDemotion(target.role, nextRole)) {
        await assertAdminsRemain(target, 'demote this account');
      }

      return withTransaction(db, async (tx) => {
        const updated = await setUserRole(execOf(tx), target.id, nextRole);
        if (!updated) throw notFound('User not found.');

        // A demotion must take effect now, not when the current access token
        // expires. A promotion needs no revocation: the new role is picked up
        // on the next refresh, and the old token grants strictly less.
        const sessionsRevoked = isDemotion(target.role, nextRole)
          ? await revokeAllSessions(tx, target.id)
          : null;

        await recordAdminAudit(tx, {
          actorId,
          action: 'admin.user_role_changed',
          targetType: 'user',
          targetId: target.id,
          payload: {
            ...(request.body.reason !== undefined ? { reason: request.body.reason } : {}),
            from_role: target.role,
            to_role: nextRole,
            demotion: isDemotion(target.role, nextRole),
            mfa_required: mfaRequiredForRole(nextRole),
            sessions_revoked: sessionsRevoked,
          },
        });

        return {
          user: { ...target, role: nextRole },
          previous_role: target.role,
          /**
           * The grant succeeded, but `isStaff()` will refuse this account until
           * it presents an MFA-backed session. The console MUST surface this or
           * the newly promoted moderator sees nothing but 403s.
           */
          mfa_required: mfaRequiredForRole(nextRole),
          sessions_revoked: sessionsRevoked,
        };
      });
    },
  );

  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    `${prefix}/admin/users/:id/force-logout`,
    { ...mutation, schema: { params: idParams, body: forceLogoutBody } },
    async (request) => {
      const actorId = actorIdOf(request);
      await staffGate(request, ADMIN_USER_RESOURCE, 'read');
      const target = await loadUser(request.params.id);
      await authorize(actorOf(request), 'moderate', ADMIN_USER_RESOURCE, resourceOf(target));

      const sessionsRevoked = await revokeAllSessions(db, target.id);
      if (sessionsRevoked === null) {
        request.log.warn(
          { user_id: target.id },
          'force-logout requested but no session revoker is wired (see modules/admin/sessions.ts)',
        );
      }

      await recordAdminAudit(db, {
        actorId,
        action: 'admin.user_sessions_revoked',
        targetType: 'user',
        targetId: target.id,
        payload: {
          ...(request.body?.reason !== undefined ? { reason: request.body.reason } : {}),
          sessions_revoked: sessionsRevoked,
        },
      });

      return { user_id: target.id, sessions_revoked: sessionsRevoked };
    },
  );

  // =========================================================================
  // Audit log viewer — read-only, staff-only, no exceptions
  // =========================================================================

  app.get<{
    Querystring: {
      actor_id?: string;
      action?: string;
      target_type?: string;
      target_id?: string;
      from?: string;
      to?: string;
      cursor?: string;
      limit?: number;
    };
  }>(
    `${prefix}/admin/audit`,
    { ...read, schema: { querystring: auditListQuery } },
    async (request) => {
      await authorize(actorOf(request), 'list', AUDIT_LOG_RESOURCE);
      const q = request.query;
      return repo.listAuditLog(db, { ...q, limit: q.limit ?? 20 });
    },
  );

  // =========================================================================
  // Seller onboarding — INTAKE ONLY (Phase 4 is stores/verification/payments)
  // =========================================================================

  app.post<{ Body: { business_name: string; contact_email: string; notes?: string | null } }>(
    `${prefix}/seller-applications`,
    { ...mutation, schema: { body: sellerApplicationCreateBody } },
    async (request, reply) => {
      const actorId = actorIdOf(request);
      await authorize(actorOf(request), 'create', SELLER_APPLICATION_RESOURCE);

      const created = await repo.insertSellerApplication(db, {
        userId: actorId,
        businessName: request.body.business_name.trim(),
        contactEmail: request.body.contact_email.trim().toLowerCase(),
        notes: request.body.notes ?? null,
      });

      await recordAdminAudit(db, {
        actorId,
        action: 'admin.seller_application_submitted',
        targetType: 'seller_application',
        targetId: created.id,
        payload: { user_id: actorId, business_name: created.business_name },
      });

      return reply.status(201).send(created);
    },
  );

  /** The applicant's own view. Scoped to the caller in SQL, never by filter. */
  app.get<{ Querystring: { cursor?: string; limit?: number } }>(
    `${prefix}/seller-applications/me`,
    { ...read, schema: { querystring: selfListQuery } },
    async (request) => {
      const actorId = actorIdOf(request);
      await authorize(actorOf(request), 'list', SELLER_APPLICATION_RESOURCE);
      return repo.listSellerApplications(db, {
        user_id: actorId,
        cursor: request.query.cursor,
        limit: request.query.limit ?? 20,
      });
    },
  );

  /**
   * The staff queue. Authorized with `moderate`, not `list`: reading this
   * endpoint means reading OTHER people's applications, which is a moderation
   * capability rather than a read of your own data. (`sessionPolicy` in
   * identity uses the same "the handler scopes it" convention for the
   * self-scoped variant above.)
   */
  app.get<{
    Querystring: {
      status?: SellerApplicationStatus;
      user_id?: string;
      cursor?: string;
      limit?: number;
    };
  }>(
    `${prefix}/admin/seller-applications`,
    { ...read, schema: { querystring: sellerApplicationListQuery } },
    async (request) => {
      await authorize(actorOf(request), 'moderate', SELLER_APPLICATION_RESOURCE);
      const q = request.query;
      return repo.listSellerApplications(db, { ...q, limit: q.limit ?? 20 });
    },
  );

  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    `${prefix}/admin/seller-applications/:id/approve`,
    { ...mutation, schema: { params: idParams, body: sellerApplicationDecisionBody } },
    async (request) => {
      const actorId = actorIdOf(request);
      await staffGate(request, SELLER_APPLICATION_RESOURCE, 'moderate');
      const application = await repo.findSellerApplication(db, request.params.id);
      if (!application) throw notFound('Application not found.');
      await authorize(actorOf(request), 'moderate', SELLER_APPLICATION_RESOURCE, {
        id: application.id,
        user_id: application.user_id,
        status: application.status,
      });

      if (application.status !== 'pending') {
        throw conflict(`This application was already ${application.status}.`);
      }

      const applicant = await repo.findAdminUserById(db, application.user_id);
      if (!applicant) throw notFound('Applicant account no longer exists.');
      if (applicant.status !== 'active') {
        throw conflict('Refusing to approve: the applicant account is not active.');
      }

      // Approval grants exactly `seller_owner`, and only to an ordinary user.
      // An existing moderator/editor/admin is NOT downgraded to seller_owner by
      // approving their shop application — that would be a privilege change
      // smuggled through the marketplace queue.
      const grantsRole = applicant.role === 'user';

      return withTransaction(db, async (tx) => {
        const decided = await repo.decideSellerApplication(tx, application.id, 'approved', actorId);
        // Lost the compare-and-set race with another moderator.
        if (!decided) throw conflict('This application was decided by someone else just now.');

        if (grantsRole) {
          const updated = await setUserRole(execOf(tx), applicant.id, 'seller_owner');
          if (!updated) throw notFound('Applicant account no longer exists.');
          await recordAdminAudit(tx, {
            actorId,
            action: 'admin.user_role_changed',
            targetType: 'user',
            targetId: applicant.id,
            payload: {
              from_role: applicant.role,
              to_role: 'seller_owner',
              via: 'seller_application',
              application_id: application.id,
              mfa_required: mfaRequiredForRole('seller_owner'),
            },
          });
        }

        await recordAdminAudit(tx, {
          actorId,
          action: 'admin.seller_application_approved',
          targetType: 'seller_application',
          targetId: application.id,
          payload: {
            ...(request.body?.reason !== undefined ? { reason: request.body.reason } : {}),
            user_id: applicant.id,
            role_granted: grantsRole ? 'seller_owner' : null,
            existing_role: applicant.role,
          },
        });

        return {
          application: decided,
          user_id: applicant.id,
          role_granted: grantsRole,
          role: grantsRole ? ('seller_owner' as Role) : applicant.role,
          mfa_required: mfaRequiredForRole(grantsRole ? 'seller_owner' : applicant.role),
        };
      });
    },
  );

  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    `${prefix}/admin/seller-applications/:id/reject`,
    { ...mutation, schema: { params: idParams, body: sellerApplicationDecisionBody } },
    async (request) => {
      const actorId = actorIdOf(request);
      await staffGate(request, SELLER_APPLICATION_RESOURCE, 'moderate');
      const application = await repo.findSellerApplication(db, request.params.id);
      if (!application) throw notFound('Application not found.');
      await authorize(actorOf(request), 'moderate', SELLER_APPLICATION_RESOURCE, {
        id: application.id,
        user_id: application.user_id,
        status: application.status,
      });

      const decided = await repo.decideSellerApplication(db, application.id, 'rejected', actorId);
      if (!decided) throw conflict(`This application was already ${application.status}.`);

      await recordAdminAudit(db, {
        actorId,
        action: 'admin.seller_application_rejected',
        targetType: 'seller_application',
        targetId: application.id,
        payload: {
          ...(request.body?.reason !== undefined ? { reason: request.body.reason } : {}),
          user_id: application.user_id,
        },
      });

      return decided;
    },
  );

  // =========================================================================
  // Moderation queue
  // =========================================================================

  app.post<{
    Body: {
      target_type: ReportTargetType;
      target_id: string;
      reason: ReportReason;
      detail?: string | null;
    };
  }>(
    `${prefix}/reports`,
    { ...mutation, schema: { body: reportCreateBody } },
    async (request, reply) => {
      const actorId = actorIdOf(request);
      await authorize(actorOf(request), 'create', REPORT_RESOURCE);

      const targetId = request.body.target_id.trim();
      if (targetId.length === 0) throw badRequest('target_id must not be blank.');
      if (request.body.target_type === 'user' && targetId === actorId) {
        throw badRequest('You cannot report yourself.');
      }

      const created = await repo.insertReport(db, {
        reporterId: actorId,
        targetType: request.body.target_type,
        targetId,
        reason: request.body.reason,
        detail: request.body.detail ?? null,
      });

      await recordAdminAudit(db, {
        actorId,
        action: 'admin.report_created',
        targetType: 'report',
        targetId: created.id,
        payload: {
          target_type: created.target_type,
          target_id: created.target_id,
          reason: created.reason,
        },
      });

      return reply.status(201).send(created);
    },
  );

  /** The reporter's own submissions. Scoped in SQL. */
  app.get<{ Querystring: { cursor?: string; limit?: number } }>(
    `${prefix}/reports/me`,
    { ...read, schema: { querystring: selfListQuery } },
    async (request) => {
      const actorId = actorIdOf(request);
      await authorize(actorOf(request), 'list', REPORT_RESOURCE);
      return repo.listReports(db, {
        reporter_id: actorId,
        cursor: request.query.cursor,
        limit: request.query.limit ?? 20,
      });
    },
  );

  app.get<{ Params: { id: string } }>(
    `${prefix}/reports/:id`,
    { ...read, schema: { params: idParams } },
    async (request) => {
      const report = await repo.findReport(db, request.params.id);
      if (!report) throw notFound('Report not found.');
      // Owner or staff — decided by the policy, from the stored row.
      await authorize(actorOf(request), 'read', REPORT_RESOURCE, {
        id: report.id,
        reporter_id: report.reporter_id,
        status: report.status,
      });
      return report;
    },
  );

  app.get<{
    Querystring: {
      status?: ReportStatus;
      target_type?: ReportTargetType;
      target_id?: string;
      reporter_id?: string;
      cursor?: string;
      limit?: number;
    };
  }>(
    `${prefix}/admin/reports`,
    { ...read, schema: { querystring: reportListQuery } },
    async (request) => {
      await authorize(actorOf(request), 'moderate', REPORT_RESOURCE);
      const q = request.query;
      return repo.listReports(db, { ...q, limit: q.limit ?? 20 });
    },
  );

  app.post<{ Params: { id: string } }>(
    `${prefix}/admin/reports/:id/claim`,
    { ...mutation, schema: { params: idParams } },
    async (request) => {
      const actorId = actorIdOf(request);
      await staffGate(request, REPORT_RESOURCE, 'moderate');
      const report = await repo.findReport(db, request.params.id);
      if (!report) throw notFound('Report not found.');
      await authorize(actorOf(request), 'moderate', REPORT_RESOURCE, {
        id: report.id,
        reporter_id: report.reporter_id,
        status: report.status,
      });

      const claimed = await repo.claimReport(db, report.id, actorId);
      if (!claimed) throw conflict(`This report is already ${report.status}.`);

      await recordAdminAudit(db, {
        actorId,
        action: 'admin.report_claimed',
        targetType: 'report',
        targetId: report.id,
        payload: { target_type: report.target_type, target_id: report.target_id },
      });

      return claimed;
    },
  );

  app.post<{
    Params: { id: string };
    Body: { outcome: 'actioned' | 'dismissed'; resolution: string };
  }>(
    `${prefix}/admin/reports/:id/resolve`,
    { ...mutation, schema: { params: idParams, body: reportResolveBody } },
    async (request) => {
      const actorId = actorIdOf(request);
      await staffGate(request, REPORT_RESOURCE, 'moderate');
      const report = await repo.findReport(db, request.params.id);
      if (!report) throw notFound('Report not found.');
      await authorize(actorOf(request), 'moderate', REPORT_RESOURCE, {
        id: report.id,
        reporter_id: report.reporter_id,
        status: report.status,
      });

      const resolved = await repo.resolveReport(
        db,
        report.id,
        request.body.outcome,
        request.body.resolution,
        actorId,
      );
      if (!resolved) throw conflict(`This report is already ${report.status}.`);

      await recordAdminAudit(db, {
        actorId,
        action: 'admin.report_resolved',
        targetType: 'report',
        targetId: report.id,
        payload: {
          outcome: request.body.outcome,
          resolution: request.body.resolution,
          target_type: report.target_type,
          target_id: report.target_id,
        },
      });

      return resolved;
    },
  );
}
