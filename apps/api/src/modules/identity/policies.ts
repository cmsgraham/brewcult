/**
 * Identity object policies — EF §3.2, backlog ID-08.
 *
 * Registered once at startup; every identity handler resolves
 * (actor, action, resource) through `authorize()` and never compares ids
 * inline. Anything not explicitly allowed below is denied, because
 * `authorize()` treats a non-`true` return as a refusal.
 */
import {
  type Actor,
  definePolicy,
  isOwner,
  isStaff,
  type Policy,
} from '../../lib/policy.js';
import type { SessionResource, UserResource } from './types.js';

export const USER_RESOURCE = 'user';
export const SESSION_RESOURCE = 'session';

/**
 * `user` policy.
 *  - read: allowed for everyone, but the *projection* differs — handlers return
 *    `toPublicProfile()` to third parties and `toSelfProfile()` to the subject
 *    and to staff (ID-12: conservative defaults). Deleted/suspended accounts are
 *    readable only by their owner or staff.
 *  - update/delete: the subject only. Staff cannot silently edit a profile;
 *    they act through `moderate`, which is audit-logged.
 *  - moderate/list: staff, and `isStaff()` additionally demands `actor.mfa`.
 */
export const userPolicy: Policy<UserResource> = (actor, action, resource) => {
  if (action === 'create') return true; // registration is open to anonymous callers
  if (action === 'list') return isStaff(actor);

  if (!resource) return false;

  switch (action) {
    case 'read':
      if (resource.status === 'active') return true;
      return isOwner(actor, resource.id) || isStaff(actor);
    case 'update':
    case 'delete':
      return isOwner(actor, resource.id);
    case 'moderate':
      // Staff may not moderate themselves out of trouble, nor act on a peer of
      // equal-or-greater standing: role changes on an admin require an admin.
      if (!isStaff(actor)) return false;
      if (isOwner(actor, resource.id)) return false;
      return actor.role === 'admin' || resource.role === 'user';
    default:
      return false;
  }
};

/**
 * `session` policy — a refresh-token family belongs to exactly one user, and
 * only that user may list or revoke it. Staff have no read access to other
 * people's device lists: that is surveillance, not moderation.
 */
export const sessionPolicy: Policy<SessionResource> = (actor: Actor, action, resource) => {
  if (actor.userId === null) return false;
  if (action === 'list') return true; // scoped to the actor's own rows by the handler
  if (!resource) return false;
  if (action === 'read' || action === 'delete') return isOwner(actor, resource.userId);
  return false;
};

/**
 * Idempotent registration. `definePolicy` refuses duplicates by design (a
 * second registration would silently shadow the first), but building several
 * app instances in a test run must not explode — so a duplicate is treated as
 * "already done".
 */
export function registerIdentityPolicies(): void {
  define(USER_RESOURCE, userPolicy);
  define(SESSION_RESOURCE, sessionPolicy);
}

function define<T>(resourceType: string, policy: Policy<T>): void {
  try {
    definePolicy(resourceType, policy);
  } catch (err) {
    if (!(err instanceof Error) || !err.message.includes('already registered')) throw err;
  }
}
