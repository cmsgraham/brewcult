/**
 * Audit seam onto the identity module — EF §3.2 ("role changes, staff actions
 * and permission grants are audit-logged"), §3.7 (append-only).
 *
 * `audit_log` belongs to identity and is immutable by database trigger, so this
 * module never INSERTs into it directly: every record goes through identity's
 * published `recordAuditEvent()`. That is the cross-module interface EF §1.2
 * calls for, and it means the admin lane physically cannot invent a second,
 * softer audit path.
 *
 * WHAT GETS AUDITED HERE: every mutation the admin surface performs, without
 * exception. Unlike the brewing lane — which correctly logs only
 * permission-relevant recipe events and sends the rest to the outbox — an
 * operator surface has no "routine" mutation. Suspending an account, granting a
 * role, approving a seller and resolving a report are all, by definition, the
 * exercise of privilege over someone else. If it changed a row from
 * `/v1/admin/**`, it is in the trail.
 *
 * ACTOR CONVENTION
 *   `actorId: <uuid>` — a staff member acting through the HTTP surface.
 *   `actorId: null`   — the SYSTEM: the ADMIN_EMAILS bootstrap and the
 *                       break-glass CLI. 0002 documents NULL as "system" and
 *                       gives actor_id no foreign key, so a system row survives
 *                       a later hard-delete of every human involved. Both
 *                       system paths additionally stamp `payload.actor` with
 *                       the literal string 'system' plus the mechanism, because
 *                       "who did this and how" is the first question asked
 *                       during an incident and NULL alone does not answer it.
 *
 * THE ONE CAST: identity's `AuditAction` is a closed union of identity's own
 * actions (typos fail the build — a good rule). Widening it is an identity-lane
 * change; until it lands, the admin actions are declared as their own union
 * here, narrowed to `string`, and cast at this single seam. There is exactly one
 * place to fix. Flagged in the lane report.
 */

import { recordAuditEvent, type AuditAction } from '../identity/index.js';
import { execOf } from './repository.js';
import type { AdminDb } from './types.js';

export type AdminAuditAction =
  // bootstrap (system actor)
  | 'admin.bootstrap_granted'
  // user administration
  | 'admin.user_role_changed'
  | 'admin.user_suspended'
  | 'admin.user_reactivated'
  | 'admin.user_sessions_revoked'
  // seller onboarding
  | 'admin.seller_application_submitted'
  | 'admin.seller_application_approved'
  | 'admin.seller_application_rejected'
  // moderation queue
  | 'admin.report_created'
  | 'admin.report_claimed'
  | 'admin.report_resolved'
  // catalogue proposals (0011). Audited because "who decided this grinder has
  // 48mm burrs, and on what evidence?" is a question the catalogue should be
  // able to answer years later.
  | 'admin.equipment_request_approved'
  | 'admin.equipment_request_rejected'
  // Confirming a row the ASSISTANT published (0013). The interesting audit
  // question inverted when the human moved after publication: it is no longer
  // "who let this in" but "who has checked what was let in, and when".
  | 'admin.equipment_reviewed';

export type AdminAuditTargetType =
  | 'user'
  | 'seller_application'
  | 'report'
  | 'equipment_request'
  | 'equipment_model';

export interface AdminAuditEvent {
  /** Acting staff member; null = system (bootstrap / CLI). */
  actorId: string | null;
  action: AdminAuditAction;
  targetType: AdminAuditTargetType;
  targetId: string;
  /**
   * Identifiers and decisions only — never secrets, never token material, never
   * a password hash (EF §4.1 minimisation). "Before and after" values of the
   * column that changed are the useful shape.
   */
  payload?: Record<string, unknown>;
}

export async function recordAdminAudit(db: AdminDb, event: AdminAuditEvent): Promise<void> {
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
