/**
 * Session-revocation seam onto the identity module.
 *
 * THE PROBLEM
 *   Suspending an account must log it out. `users.status` alone already blocks
 *   the two doors identity guards — `POST /v1/auth/login` refuses a non-active
 *   account, and `POST /v1/auth/refresh` re-reads the row and refuses it too —
 *   so a suspension is never merely cosmetic. But the access token already in
 *   the abusive user's hand stays valid for up to its 15-minute TTL, and their
 *   refresh-token FAMILIES stay live in the table, which means:
 *     * the operator's "sessions" view keeps showing green devices, and
 *     * a later reactivation silently restores every old session rather than
 *       forcing a fresh, observable login.
 *   Both are wrong. Suspension should revoke the families.
 *
 * THE CONSTRAINT
 *   `refresh_tokens` is identity's table (0002/0005) and EF §1.2 makes table
 *   ownership a module boundary, so the admin lane must not UPDATE it. Identity
 *   HAS the right helper — `revokeAllFamiliesForUser(exec, userId, exceptFamilyId?)`
 *   in `modules/identity/tokens.ts` — but does not re-export it from
 *   `modules/identity/index.ts`, and dependency-cruiser (correctly) makes
 *   reaching past that index a hard error.
 *
 * THE SEAM (three ways in, in priority order)
 *   1. EXPLICIT INJECTION — `setSessionRevoker(fn)`, or
 *      `registerAdminRoutes(app, { revokeSessions })`. The bootstrap wires
 *      whatever it has. This is what the test suite uses, with identity's real
 *      `revokeAllFamiliesForUser`, so the seam is proven against the actual
 *      implementation and not a stub.
 *   2. AUTO-DISCOVERY — a lazy dynamic import of identity's PUBLIC interface
 *      (`../identity/index.js`, which the boundary rules explicitly allow),
 *      looking for a `revokeAllFamiliesForUser` export. It is absent today, so
 *      this resolves to null; the DAY identity adds the one line
 *
 *          export { revokeAllFamiliesForUser } from './tokens.js';
 *
 *      to its index, revocation starts working with ZERO changes here and zero
 *      in app.ts. That one line is the entire ask on the identity lane; it is
 *      recorded in this module's README and in the lane report.
 *   3. NOTHING WIRED — `revokeAllSessions()` returns null. The caller does NOT
 *      silently swallow that: the suspend/force-logout responses carry
 *      `sessions_revoked: null`, the audit payload records
 *      `sessions_revoked: null`, and the route logs a warning. A degraded
 *      control that reports itself degraded is recoverable; one that reports
 *      success is a lie the next incident review has to untangle.
 *
 * The status change itself is never conditional on the revoker. Refusing to
 * suspend an abusive account because a seam is unwired would be exactly the
 * wrong failure mode.
 */

import type { AdminDb, Exec } from './types.js';
import { execOf } from './repository.js';

/**
 * Revokes every live refresh-token family belonging to a user and returns how
 * many rows were revoked. Signature-compatible with identity's
 * `revokeAllFamiliesForUser`, third parameter included, so that function can be
 * passed straight in.
 */
export type SessionRevoker = (
  exec: Exec,
  userId: string,
  exceptFamilyId?: string | null,
) => Promise<number>;

let injected: SessionRevoker | null = null;
/** Auto-discovery runs at most once; `false` means "tried, not available". */
let discovered: SessionRevoker | false | null = null;

/**
 * Installs the revoker. Pass `null` to clear (the test suite does this between
 * scenarios to exercise the unwired path).
 */
export function setSessionRevoker(revoker: SessionRevoker | null): void {
  injected = revoker;
}

/** Test-only: forget the auto-discovery result so it runs again. */
export function resetSessionRevokerDiscovery(): void {
  discovered = null;
}

/**
 * Resolves the revoker, preferring an explicit injection and falling back to
 * identity's public interface. The dynamic import is the only reason this is
 * async; it is memoised, so the cost is paid once per process.
 */
export async function resolveSessionRevoker(): Promise<SessionRevoker | null> {
  if (injected) return injected;
  if (discovered !== null) return discovered === false ? null : discovered;

  try {
    const mod: unknown = await import('../identity/index.js');
    const candidate = (mod as Record<string, unknown>)['revokeAllFamiliesForUser'];
    discovered = typeof candidate === 'function' ? (candidate as SessionRevoker) : false;
  } catch {
    // Identity's index failing to load is a bootstrap problem that will surface
    // far more loudly elsewhere; here it just means "no revoker".
    discovered = false;
  }
  return discovered === false ? null : discovered;
}

/**
 * Revokes every session for `userId`.
 *
 * @returns the number of families revoked, or `null` when no revoker is wired.
 *          Callers MUST propagate the null rather than coercing it to 0.
 */
export async function revokeAllSessions(
  db: AdminDb,
  userId: string,
  exceptFamilyId?: string | null,
): Promise<number | null> {
  const revoker = await resolveSessionRevoker();
  if (!revoker) return null;
  return revoker(execOf(db), userId, exceptFamilyId ?? null);
}
