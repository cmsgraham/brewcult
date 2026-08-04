/**
 * Append-only audit trail — EF §3.2 / §3.7, backlog ID-09.
 *
 * `audit_log` has a BEFORE UPDATE/DELETE/TRUNCATE trigger that raises
 * unconditionally (0002_identity.sql), so this module offers exactly one
 * operation: INSERT. There is deliberately no update/delete helper — a
 * compromised app server must not be able to rewrite its own history.
 *
 * Payloads carry identifiers and decisions, never secrets: no tokens, no code
 * values, no password material (EF §4.1 minimisation).
 */
import type { Exec } from './types.js';

/** Actions this module writes. Kept as a union so typos fail the build. */
export type AuditAction =
  | 'user.registered'
  | 'user.email_verified'
  | 'user.email_change_requested'
  | 'user.email_changed'
  | 'user.password_changed'
  | 'user.password_reset_completed'
  | 'user.profile_updated'
  | 'user.deactivated'
  | 'user.role_changed'
  | 'user.status_changed'
  | 'auth.login_succeeded'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'auth.session_revoked'
  | 'auth.all_sessions_revoked'
  | 'auth.refresh_reuse_detected'
  | 'auth.family_revoked'
  | 'auth.identity_linked'
  | 'auth.identity_link_refused'
  | 'auth.identity_unlinked'
  | 'mfa.enrolment_started'
  | 'mfa.enabled'
  | 'mfa.disabled'
  | 'mfa.recovery_code_used'
  | 'mfa.recovery_codes_regenerated';

export interface AuditEvent {
  /** Acting user; null for system/anonymous actions. */
  actorId: string | null;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  payload?: Record<string, unknown>;
}

export async function recordAuditEvent(exec: Exec, event: AuditEvent): Promise<void> {
  await exec(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [
      event.actorId,
      event.action,
      event.targetType ?? null,
      event.targetId ?? null,
      JSON.stringify(event.payload ?? {}),
    ],
  );
}
