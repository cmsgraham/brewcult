/**
 * MEDIA MODULE — PUBLIC INTERFACE (EF §1.2, §3.5), backlog BREW-06.
 *
 * This file is the module's entire contract. `.dependency-cruiser.cjs` makes any
 * import of `modules/media/<anything-else>` from outside a hard error, so
 * everything another lane needs appears below — and nothing below can change
 * without noticing who depends on it.
 *
 * Wiring in `apps/api/src/app.ts` is two lines, AFTER identity (this module
 * consumes identity's actor plugin, its CSRF guard and its audit writer):
 *
 *     import { registerMediaRoutes } from './modules/media/index.js';
 *     await registerMediaRoutes(app);
 *
 * ── ROUTE MAP ───────────────────────────────────────────────────────────────
 *   POST   /v1/media?kind=…            multipart upload; 201 with the media DTO
 *                                      kinds avatar|brew_photo: any authenticated user
 *                                      kinds coffee_image|equipment_image|roaster_logo: staff
 *   GET    /v1/media/:id               metadata + absolute URLs (anonymous OK
 *                                      when the media hangs off a public entity)
 *   DELETE /v1/media/:id               owner or staff; soft-delete + object removal
 *   PUT    /v1/users/me/avatar         { media_id } — owner only; retires the previous avatar
 *   PUT    /v1/admin/media/attach      { media_id, target_type, target_id } — staff, audited
 *
 * ── WHAT THIS MODULE GUARANTEES ─────────────────────────────────────────────
 * A `media` row exists only for bytes this API decoded and re-encoded itself:
 *   • the type comes from MAGIC BYTES, never the extension or Content-Type;
 *   • the allowlist is JPEG/PNG/WebP/HEIC — SVG is refused by name (it is a
 *     script-capable document, not a raster image);
 *   • every accepted file is decoded and re-emitted by sharp, so appended
 *     payloads, polyglot tails and ALL metadata — EXIF included, GPS above all
 *     — are absent from the stored object by construction, not by stripping;
 *   • objects live at unguessable keys on the cookie-less media origin and are
 *     never proxied through the API.
 * Anything that wants to trust an image should go through `assertMediaUsable()`
 * rather than re-deriving those properties.
 *
 * ── WIRING THIS MODULE NEEDS FROM OTHER LANES ───────────────────────────────
 *   1. `app.ts` — the two lines above (this lane must not edit that file).
 *   2. brewing — ONE line in the brew-session create/update path, before
 *      `photo_media_id` is written:
 *          await assertMediaUsable(db, body.photo_media_id, actorId, 'brew_photo');
 *      Without it a user can point `photo_media_id` at ANOTHER user's media id.
 *      The FK added by 0008 stops a dangling id; only this call stops an IDOR.
 *   3. identity/catalog (follow-up, not blocking) — publishing `setUserAvatar()`
 *      and `setEntityImage()` would let this module stop writing their columns
 *      directly. See the 0008 header and modules/media/repository.ts.
 *   4. infra (dev + prod) — the media bucket must allow anonymous GET so the
 *      cookie-less origin can serve objects:
 *          mc anonymous set download local/brewcult-media
 *      That is the capability-URL model (unguessable keys, EF §3.5); without it
 *      every URL this API returns 403s at the media origin.
 */

import type { FastifyInstance } from 'fastify';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { registerMediaPolicies } from './policies.js';
import { dbOf, findMediaRef } from './repository.js';
import { registerMediaRoutes as registerRoutes, type MediaRouteOptions } from './routes.js';
import type { Exec, MediaDb, MediaKind, MediaRef } from './types.js';

/**
 * Registers the media policy and every media route.
 *
 * The policy is registered FIRST and unconditionally: a resource type with no
 * policy is inaccessible (default deny), so registering routes without
 * registering the policy would produce a silently 403-ing upload endpoint.
 */
export async function registerMediaRoutes(
  app: FastifyInstance,
  options: MediaRouteOptions = {},
): Promise<void> {
  registerMediaPolicies();
  await registerRoutes(app, options);
}

export type { MediaRouteOptions } from './routes.js';

// --- THE SEAM OTHER MODULES CALL -------------------------------------------

/**
 * "May this user attach this media here?" — the one function another module
 * needs in order to write a media id into its own table.
 *
 * Brewing owns `brew_sessions` and must not be rewritten by this lane, so the
 * brew-photo attachment is NOT an endpoint here: brewing keeps writing
 * `photo_media_id` on its own create/update path and calls this first. One line
 * (see the wiring note above).
 *
 * WHY A COLUMN AND NOT A MEDIA-OWNED JOIN TABLE: a join table would let this
 * module own the linkage, which sounds tidier — but `brew_sessions.photo_media_id`
 * already exists (0006, with the FK explicitly deferred to 0008), brewing's
 * repository already selects it, and it is part of the row's `body_hash` and of
 * the sync projection. Introducing a second mechanism would give the platform
 * two sources of truth for "which photo is on this brew" and would leave the
 * column behind as a trap. It is also a strict 0..1 relationship, which is what
 * a nullable FK column is for.
 *
 * Accepts either seam shape: a bare exec function or anything with `.query`
 * (brewing's `BrewingDb`), so no caller has to build an adapter.
 *
 * Throws — never returns false — so a caller cannot forget to check the result:
 *   404 the media does not exist
 *   403 it belongs to someone else            ← the IDOR this call exists to stop
 *   400 wrong kind, or not in 'ready' state
 */
export async function assertMediaUsable(
  executor: Exec | MediaDb,
  mediaId: string,
  userId: string,
  kind: MediaKind,
): Promise<MediaRef> {
  const ref = await findMediaRef(dbOf(executor), mediaId);
  if (!ref) throw notFound('Media not found.');
  // Ownership first: "wrong kind" would otherwise confirm the existence and
  // shape of another user's media to whoever guessed the id.
  if (ref.owner_id !== userId) throw forbidden('That image is not yours.');
  if (ref.status !== 'ready') throw badRequest('That image is not ready to use.');
  if (ref.kind !== kind) {
    throw badRequest(`That image was uploaded as '${ref.kind}', not '${kind}'.`);
  }
  return ref;
}

// --- policy surface ---------------------------------------------------------

export { MEDIA_RESOURCE, mediaPolicy, registerMediaPolicies } from './policies.js';

// --- read surface for other modules ----------------------------------------
//
// Callers are responsible for authorizing the actor first — the policy above is
// exported for exactly that.

/**
 * `listOwnedStorageKeys` is for the account-deletion job (BREW-10): the FK
 * cascade in 0008 removes the media ROWS when a user is deleted, so the OBJECTS
 * have to be enumerated with this and purged FIRST or they are orphaned in the
 * bucket forever.
 */
export {
  defaultMediaDb,
  findMediaById,
  findMediaRef,
  listOwnedStorageKeys,
  loadMediaResource,
  quotaUsage,
} from './repository.js';

/** Absolute URL on the cookie-less media origin for a stored key. */
export { mediaUrl, memoryStorage, s3Storage, type MediaStorage } from './storage.js';

/** The public projection, so other modules can embed a media DTO in their own. */
export { toDto } from './routes.js';

// --- pipeline internals worth publishing ------------------------------------
/** The allowlist and the sniffer, for anyone writing an upload UI or a test. */
export { ALLOWED_INPUT_MIME, isAllowedInput, sniff, type SniffResult } from './sniff.js';
export { MAX_LONG_EDGE, MAX_UPLOAD_BYTES, OUTPUT_MIME, THUMBNAIL_LONG_EDGE } from './images.js';
export {
  QUOTA_MAX_TOTAL_BYTES,
  QUOTA_MAX_UPLOADS,
  QUOTA_MAX_WINDOW_BYTES,
  QUOTA_WINDOW_HOURS,
} from './quota.js';

// --- audit ------------------------------------------------------------------
export { recordMediaAudit, type MediaAuditAction, type MediaAuditEvent } from './audit.js';

// --- types ------------------------------------------------------------------

export {
  ATTACH_TARGET_TYPES,
  KIND_FOR_TARGET,
  MEDIA_KINDS,
  MEDIA_STATUSES,
  SELF_SERVE_KINDS,
  STAFF_KINDS,
  type AttachTargetType,
  type MediaDb,
  type MediaDto,
  type MediaKind,
  type MediaRef,
  type MediaResource,
  type MediaRow,
  type MediaStatus,
  type QuotaUsage,
} from './types.js';
