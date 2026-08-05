/**
 * Media authorization policy (EF §3.2).
 *
 * One resource type, `media`, and one function that answers every question
 * about it. Route handlers load the resource (`loadMediaResource`) and resolve
 * (actor, action, resource) through `authorize()` — there is no inline
 * ownership comparison anywhere in this module, which is the structural
 * defence against IDOR the policy layer exists for.
 *
 * The read rule is the interesting one, because media has TWO different
 * audiences depending on what it is attached to:
 *
 *   • A coffee bag shot, an equipment photo, a roaster logo or an avatar hangs
 *     off a P0-public entity (EF §4.1). Anonymous read is the product: the web
 *     client must be able to render a coffee card to a logged-out visitor.
 *   • A brew photo is P1 pseudonymous activity and stays private to its owner
 *     forever, even though the same table holds it.
 *
 * `resource.public_attachment` is computed in SQL (repository.ts) and carries
 * exactly that distinction. Note the direction of the rule: media is private by
 * DEFAULT and becomes public by being attached, so a freshly uploaded file is
 * readable only by its owner until something public points at it. An upload
 * that is never attached never becomes visible to anyone else.
 *
 * A note on what this policy does NOT decide: the OBJECT in storage. Bytes are
 * served by the cookie-less media origin (EF §3.5) straight from MinIO/CDN and
 * never pass through this code. Their protection is the unguessable key — a
 * capability URL (see storage.ts). This policy governs the metadata record and
 * therefore the ability to DISCOVER the URL, which is the thing an attacker
 * enumerating ids would be after.
 */

import {
  definePolicy,
  isAuthenticated,
  isOwner,
  isStaff,
  type Action,
  type Actor,
} from '../../lib/policy.js';
import type { MediaResource } from './types.js';

export const MEDIA_RESOURCE = 'media';

export function mediaPolicy(
  actor: Actor,
  action: Action,
  resource: MediaResource | undefined,
): boolean {
  switch (action) {
    // Uploading requires nothing more than an account. WHICH kinds may be
    // uploaded is a separate question answered in routes.ts (catalog imagery is
    // staff-only) — kind is not part of the policy resource on create, because
    // there is no resource yet.
    case 'create':
      return isAuthenticated(actor);

    case 'read': {
      if (!resource) return false;
      // A soft-deleted row is gone as far as the product is concerned. Staff
      // can still see it, because "what was attached here before?" is a real
      // moderation question.
      if (resource.status === 'deleted') return isStaff(actor);
      // Never expose a half-processed or rejected upload to anyone but its
      // owner (and staff) — the URL may not point at anything yet.
      if (resource.status !== 'ready') {
        return isOwner(actor, resource.owner_id) || isStaff(actor);
      }
      return resource.public_attachment || isOwner(actor, resource.owner_id) || isStaff(actor);
    }

    // 'update' is attachment: pointing an entity at this media. The OWNER may
    // attach their own media (that is `PUT /v1/users/me/avatar`); staff may
    // attach platform media to catalog entities. The route additionally checks
    // the target entity's own permission.
    case 'update':
      if (!resource) return isStaff(actor);
      return isOwner(actor, resource.owner_id) || isStaff(actor);

    case 'delete':
      if (!resource) return false;
      return isOwner(actor, resource.owner_id) || isStaff(actor);

    // Listing is always scoped to the caller's own uploads in SQL.
    case 'list':
      return isAuthenticated(actor);

    default:
      return false;
  }
}

/**
 * Registers the media policy. Idempotent by intent: `definePolicy` throws on a
 * duplicate resource type (the right behaviour for two modules claiming the
 * same name, the wrong behaviour for a suite that builds the app repeatedly),
 * and that duplicate error is the only error it raises.
 */
export function registerMediaPolicies(): void {
  try {
    definePolicy<MediaResource>(MEDIA_RESOURCE, (actor, action, resource) =>
      mediaPolicy(actor, action, resource),
    );
  } catch {
    // Already registered — idempotent by intent.
  }
}
