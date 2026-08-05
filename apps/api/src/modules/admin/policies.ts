/**
 * Admin authorization policies — EF §3.2, §3.8.
 *
 * "Admin/moderator/editor interfaces live behind a separate auth surface with
 * MFA enforced" (EF §3.2). That sentence is implemented HERE, not in the route
 * handlers: every policy below funnels through `isStaff()`, and `isStaff()`
 * returns false unless `actor.mfa === true`. A moderator on a password-only
 * session is, for the whole of `/v1/admin/**`, indistinguishable from an
 * anonymous stranger.
 *
 * Default-deny is the point: an admin resource type with no policy is
 * inaccessible, so the failure mode of forgetting one of these is a 403, never
 * an open door.
 *
 * WHY THE PRIVILEGE LADDER IS SPLIT
 *   `update` on admin_user  = "assign a role"  → ADMIN only.
 *   `moderate` on admin_user = "suspend / reactivate / log out" → staff, and
 *       only against an ordinary `user` unless the actor is an admin.
 * Those are genuinely different powers. A moderator dealing with an abusive
 * account needs the second; nobody but an admin should be able to mint another
 * admin — or, more to the point, to quietly promote themselves' peer and then
 * be locked out of the blast radius. Role assignment is the escalation path, so
 * it gets the narrower gate.
 *
 * WHAT IS NOT HERE
 *   Self-protection ("an admin may not demote or suspend themselves") and the
 *   last-admin check are NOT policy questions — they are invariants of the
 *   operation, and they answer 409 Conflict rather than 403 Forbidden because
 *   the actor is perfectly entitled to the action, just not to this instance of
 *   it. They live in `routes.ts` beside the mutation they protect.
 */

import {
  definePolicy,
  isAuthenticated,
  isOwner,
  isStaff,
  type Actor,
  type Action,
  type Policy,
} from '../../lib/policy.js';
import type {
  AdminUserResource,
  ReportResource,
  SellerApplicationResource,
} from './types.js';

/** Resource types this module owns. Cross-module callers use these strings. */
export const ADMIN_USER_RESOURCE = 'admin_user';
export const SELLER_APPLICATION_RESOURCE = 'seller_application';
export const REPORT_RESOURCE = 'report';
export const AUDIT_LOG_RESOURCE = 'audit_log';
/** Proposals for the shared equipment catalogue (0011). */
export const EQUIPMENT_REQUEST_RESOURCE = 'equipment_request';

export const ADMIN_RESOURCE_TYPES = [
  ADMIN_USER_RESOURCE,
  SELLER_APPLICATION_RESOURCE,
  REPORT_RESOURCE,
  AUDIT_LOG_RESOURCE,
  EQUIPMENT_REQUEST_RESOURCE,
] as const;

export type AdminResourceType = (typeof ADMIN_RESOURCE_TYPES)[number];

/**
 * `admin_user` — the operator's view of an account.
 *
 * `read`/`list` expose email, status, MFA posture and login telemetry: P2
 * personal data, hence staff-only with no owner exemption. (A user reading
 * their OWN admin row is not a thing: they have `GET /v1/users/me`, which is
 * identity's self projection.)
 */
export const adminUserPolicy: Policy<AdminUserResource> = (actor, action, resource) => {
  if (!isStaff(actor)) return false;

  switch (action) {
    case 'list':
    case 'read':
      return true;

    case 'update':
      // Role assignment. Admins only — see the privilege-ladder note above.
      return actor.role === 'admin';

    case 'moderate':
      // Suspend / reactivate / force-logout. Type-level (no resource) is
      // refused: these always act on a specific, loaded account.
      if (!resource) return false;
      // A moderator may act on ordinary users; touching another staff member
      // (or a seller_owner, who has commercial standing) requires an admin.
      return actor.role === 'admin' || resource.role === 'user';

    default:
      return false;
  }
};

/**
 * `seller_application` — marketplace intake (Phase 4 gate, EF §3.6).
 *
 * `create` is open to any authenticated account: applying is a user action.
 * `read` is the applicant or staff. `moderate` (approve/reject) is staff.
 *
 * Approving is the ONE path where a non-admin staff member causes a role grant.
 * That is deliberate and bounded: approval can grant exactly `seller_owner` and
 * nothing else, it cannot touch an existing staff account (the route refuses to
 * downgrade one), and it writes an audit row naming the approver. Widening it
 * to "any role" would make this a second, unguarded role-change endpoint —
 * which is why the route calls the shared, guard-railed grant path.
 */
export const sellerApplicationPolicy: Policy<SellerApplicationResource> = (
  actor,
  action,
  resource,
) => {
  switch (action) {
    case 'create':
      return isAuthenticated(actor);
    case 'list':
      // The route scopes a non-staff caller's list to their own rows; staff see
      // the queue. Both need `list`, so ownership is applied in SQL, not here.
      return isAuthenticated(actor);
    case 'read':
      if (!resource) return false;
      return isStaff(actor) || isOwner(actor, resource.user_id);
    case 'moderate':
      return isStaff(actor);
    default:
      return false;
  }
};

/**
 * `report` — the moderation queue.
 *
 * A reporter may create a report and read their own; only staff may list the
 * queue or resolve anything. The reported party has no access at all: exposing
 * `reporter_id` to them turns a moderation tool into a retaliation tool.
 */
export const reportPolicy: Policy<ReportResource> = (actor, action, resource) => {
  switch (action) {
    case 'create':
      return isAuthenticated(actor);
    case 'list':
      // Same split as seller applications: the route scopes non-staff to self.
      return isAuthenticated(actor);
    case 'read':
      if (!resource) return false;
      return isStaff(actor) || isOwner(actor, resource.reporter_id);
    case 'moderate':
      return isStaff(actor);
    default:
      return false;
  }
};

/**
 * `equipment_request` — proposals for the shared catalogue.
 *
 * Anybody signed in may propose; only staff may see the queue or decide. A
 * requester can read their own submission back (to see the outcome and the
 * reason) but never anybody else's, because the submission carries free text
 * and a photo somebody chose to send to REVIEWERS, not to other users.
 */
export interface EquipmentRequestResource {
  requester_id: string;
}

export const equipmentRequestPolicy: Policy<EquipmentRequestResource> = (
  actor,
  action,
  resource,
) => {
  switch (action) {
    case 'create':
      return isAuthenticated(actor);
    case 'list':
      // Same split as the other queues: the route scopes non-staff to self.
      return isAuthenticated(actor);
    case 'read':
      if (!resource) return false;
      return isStaff(actor) || isOwner(actor, resource.requester_id);
    case 'moderate':
      return isStaff(actor);
    default:
      return false;
  }
};

/**
 * `audit_log` — read-only, staff-only, forever.
 *
 * There is no `create`, `update` or `delete` case and there never will be: the
 * table is append-only by database trigger (0002), writes go through identity's
 * `recordAuditEvent()`, and a policy that admits any mutating action here would
 * be a lie about what the database permits.
 *
 * The trail names who suspended whom and why — handing it to a non-staff actor
 * would leak both moderation decisions and other users' auth events, so this
 * policy has no owner exemption either.
 */
export const auditLogPolicy: Policy<never> = (actor: Actor, action: Action) => {
  if (action !== 'list' && action !== 'read') return false;
  return isStaff(actor);
};

/**
 * Idempotent registration. `definePolicy` refuses duplicates by design (a second
 * registration would silently shadow the first), but a test suite that builds
 * several apps around `resetPolicies()` must not explode — so a duplicate is
 * treated as "already done", matching catalog and identity.
 */
export function registerAdminPolicies(): void {
  define(ADMIN_USER_RESOURCE, adminUserPolicy);
  define(SELLER_APPLICATION_RESOURCE, sellerApplicationPolicy);
  define(REPORT_RESOURCE, reportPolicy);
  define(AUDIT_LOG_RESOURCE, auditLogPolicy);
  define(EQUIPMENT_REQUEST_RESOURCE, equipmentRequestPolicy);
}

function define<T>(resourceType: string, policy: Policy<T>): void {
  try {
    definePolicy(resourceType, policy);
  } catch (err) {
    if (!(err instanceof Error) || !err.message.includes('already registered')) throw err;
  }
}
