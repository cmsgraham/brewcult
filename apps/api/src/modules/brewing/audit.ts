/**
 * Audit seam onto the identity module (EF §3.2/§3.7).
 *
 * `audit_log` belongs to identity and is append-only by database trigger, so
 * this module never writes it directly — it goes through identity's public
 * `recordAuditEvent()`, which is exactly the cross-module interface EF §1.2
 * calls for. (The catalog lane predates that export and still logs a structured
 * line; that is its follow-up, not ours.)
 *
 * WHAT GETS AUDITED: permission-relevant events only — publishing a recipe,
 * changing its visibility, deleting one, and forking someone else's. Logging a
 * brew is product telemetry, not a permission decision; it goes to the outbox
 * (`events.ts`), not here. Writing every brew into an immutable audit table
 * would drown the trail that matters during an incident.
 *
 * THE ONE CAST: identity's `AuditAction` is a closed union of identity's own
 * actions. Widening it is an identity-lane change; until it happens the brewing
 * actions are narrowed to `string` and cast at this single seam, so there is
 * exactly one place to fix. Flagged in the lane report.
 */

import { recordAuditEvent, type AuditAction } from '../identity/index.js';
import { execOf } from './repository.js';
import type { BrewingDb } from './types.js';

export type BrewingAuditAction =
  | 'recipe.created'
  | 'recipe.updated'
  | 'recipe.visibility_changed'
  | 'recipe.deleted'
  | 'recipe.forked'
  | 'recipe.conflict_copy_created'
  | 'brew.deleted';

export interface BrewingAuditEvent {
  actorId: string | null;
  action: BrewingAuditAction;
  targetType: 'recipe' | 'brew_session';
  targetId: string;
  payload?: Record<string, unknown>;
}

export async function recordBrewingAudit(
  db: BrewingDb,
  event: BrewingAuditEvent,
): Promise<void> {
  const action: string = event.action;
  await recordAuditEvent(execOf(db), {
    actorId: event.actorId,
    action: action as AuditAction,
    targetType: event.targetType,
    targetId: event.targetId,
    ...(event.payload !== undefined ? { payload: event.payload } : {}),
  });
}
