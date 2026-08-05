/**
 * Audit seam onto the identity module — EF §3.2, §3.7 (append-only).
 *
 * `audit_log` belongs to identity and is immutable by database trigger, so this
 * module never INSERTs into it directly: every record goes through identity's
 * published `recordAuditEvent()`, exactly as the admin lane does. That is the
 * cross-module interface EF §1.2 calls for, and it means the media lane cannot
 * invent a second, softer audit path.
 *
 * WHAT GETS AUDITED HERE — and, just as deliberately, what does not:
 *   • Every STAFF action. `PUT /v1/admin/media/attach` changes what the whole
 *     world sees on a catalog page; who pointed which image at which coffee is
 *     precisely the "staff action" EF §3.2 requires in the trail.
 *   • Every DELETE, including a user deleting their own photo, because a
 *     deletion is the one media event that cannot be reconstructed afterwards
 *     and is also what a compromised-account report asks about first.
 *   • REJECTED uploads are NOT written to `audit_log`. They are a security
 *     signal, not a permission event, and a trivially unauthenticated-ish
 *     endpoint that appends a row per rejected byte is a log-flood primitive.
 *     They are logged at `warn` on the request logger with the sniffed type,
 *     which is where an operator would look anyway.
 *   • Ordinary successful uploads are NOT audited either — an append-only trail
 *     of "user uploaded a photo" would drown the entries that matter. The
 *     `media` row IS the record, with created_at and owner_id.
 *
 * THE ONE CAST: identity's `AuditAction` is a closed union of identity's own
 * actions. Widening it is an identity-lane change; until it lands the media
 * actions are declared here and cast at this single seam — one place to fix,
 * flagged in the lane report. (The admin lane carries the identical note.)
 */

import { recordAuditEvent, type AuditAction } from '../identity/index.js';
import { execOf } from './repository.js';
import type { MediaDb } from './types.js';

export type MediaAuditAction =
  | 'media.deleted'
  | 'media.avatar_set'
  | 'media.avatar_cleared'
  | 'media.attached'
  | 'media.detached';

export type MediaAuditTargetType = 'media' | 'user' | 'coffee_product' | 'equipment_model' | 'roaster';

export interface MediaAuditEvent {
  /** Acting user; null = system. */
  actorId: string | null;
  action: MediaAuditAction;
  targetType: MediaAuditTargetType;
  targetId: string;
  /** Identifiers and decisions only — never bytes, never storage keys of
   *  someone else's media, never anything that would let the trail become a
   *  second copy of the data (EF §4.1 minimisation). */
  payload?: Record<string, unknown>;
}

export async function recordMediaAudit(db: MediaDb, event: MediaAuditEvent): Promise<void> {
  const action: string = event.action;
  await recordAuditEvent(execOf(db), {
    actorId: event.actorId,
    action: action as AuditAction,
    targetType: event.targetType,
    targetId: event.targetId,
    payload: {
      ...(event.payload ?? {}),
      ...(event.actorId === null ? { actor: 'system' } : {}),
    },
  });
}
