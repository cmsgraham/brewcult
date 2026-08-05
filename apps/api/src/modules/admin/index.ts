/**
 * ADMIN / OPERATIONS MODULE — PUBLIC INTERFACE (EF §1.2, §3.2, §3.7).
 *
 * This file is the module's entire contract. `.dependency-cruiser.cjs` makes any
 * import of `modules/admin/<anything-else>` from outside a hard error, so
 * everything another lane needs appears below — and nothing below can change
 * without noticing who depends on it.
 *
 * Wiring in `apps/api/src/app.ts` is two lines, AFTER identity (this module
 * consumes identity's public interface and its actor plugin):
 *
 *     import { registerAdminRoutes } from './modules/admin/index.js';
 *     await registerAdminRoutes(app);
 *
 * That single call registers the four admin policies, installs the ADMIN_EMAILS
 * bootstrap hook (only when ADMIN_EMAILS is non-empty) and mounts the route
 * tree below.
 *
 * ── ROUTE MAP ───────────────────────────────────────────────────────────────
 *   Staff-only (403 without an MFA-backed staff session, 401 anonymous):
 *     GET    /v1/admin/users                      keyset page; q/role/status/created range
 *     GET    /v1/admin/users/:id                  + recent login attempts + session counts
 *     POST   /v1/admin/users/:id/suspend          {reason} → suspended + sessions revoked
 *     POST   /v1/admin/users/:id/reactivate       → active
 *     PATCH  /v1/admin/users/:id/role             {role} → flags mfa_required
 *     POST   /v1/admin/users/:id/force-logout     revoke every session
 *     GET    /v1/admin/audit                      read-only trail; actor/action/target/date
 *     GET    /v1/admin/seller-applications        the intake queue
 *     POST   /v1/admin/seller-applications/:id/approve   promotes to seller_owner
 *     POST   /v1/admin/seller-applications/:id/reject
 *     GET    /v1/admin/reports                    the moderation queue
 *     POST   /v1/admin/reports/:id/claim          open → reviewing
 *     POST   /v1/admin/reports/:id/resolve        {outcome, resolution}
 *
 *   Any authenticated user:
 *     POST   /v1/seller-applications              apply to sell
 *     GET    /v1/seller-applications/me           own applications
 *     POST   /v1/reports                          report something (one live per target)
 *     GET    /v1/reports/me                       own reports
 *     GET    /v1/reports/:id                      own, or staff
 *
 * ── WHAT THIS MODULE IS NOT ─────────────────────────────────────────────────
 * Seller onboarding here is INTAKE plus a role grant. Stores, verification,
 * payouts and anything touching money are Phase 4 (EF §3.6) and must not be
 * inferred from an approved application row.
 *
 * ── WIRING THIS MODULE NEEDS FROM OTHER LANES ───────────────────────────────
 *   1. `app.ts` — the two lines above (this lane must not edit that file).
 *   2. identity — ONE line in `modules/identity/index.ts` to make suspension
 *      actually revoke refresh-token families:
 *          export { revokeAllFamiliesForUser } from './tokens.js';
 *      Nothing else changes: `sessions.ts` discovers it through identity's
 *      public interface automatically. Until then `sessions_revoked` is `null`
 *      in the response and in the audit payload, and the route logs a warning —
 *      the suspension itself still holds, because identity's login and refresh
 *      paths both re-read `users.status`.
 *   3. Root `package.json` — optional passthroughs so the documented CLI form
 *      works from the repo root:
 *          "admin:grant": "npm run admin:grant -w @brewcult/api --",
 *          "admin:list":  "npm run admin:list  -w @brewcult/api --"
 *      Without them the CLI is `npm run admin:grant -w @brewcult/api -- …`.
 *   4. identity (optional) — if that lane would rather own the ADMIN_EMAILS
 *      trigger explicitly instead of relying on this module's `onResponse`
 *      hook, one call after a successful login / email verification:
 *          await promoteAllowlistedAdmin(defaultAdminDb, user.email);
 *      and `registerBootstrapHook` can then be dropped.
 */

import type { FastifyInstance } from 'fastify';
import { registerBootstrapHook } from './bootstrap.js';
import { registerAdminPolicies } from './policies.js';
import { defaultAdminDb } from './repository.js';
import { registerAdminRoutes as registerRoutes, type AdminRouteOptions } from './routes.js';
import { setSessionRevoker } from './sessions.js';

/**
 * Registers the admin policies, the bootstrap hook and every admin route.
 *
 * Policies are registered FIRST and unconditionally: a resource type with no
 * policy is inaccessible (default deny), so registering routes without
 * registering policies would produce a silently 403-ing operator console —
 * the single most confusing failure mode this surface can have.
 */
export async function registerAdminRoutes(
  app: FastifyInstance,
  options: AdminRouteOptions = {},
): Promise<void> {
  registerAdminPolicies();
  if (options.revokeSessions) setSessionRevoker(options.revokeSessions);
  registerBootstrapHook(app, options.db ?? defaultAdminDb);
  await registerRoutes(app, options);
}

export type { AdminRouteOptions } from './routes.js';

// --- policy surface ---------------------------------------------------------

export {
  ADMIN_RESOURCE_TYPES,
  ADMIN_USER_RESOURCE,
  AUDIT_LOG_RESOURCE,
  REPORT_RESOURCE,
  SELLER_APPLICATION_RESOURCE,
  adminUserPolicy,
  auditLogPolicy,
  registerAdminPolicies,
  reportPolicy,
  sellerApplicationPolicy,
  type AdminResourceType,
} from './policies.js';

// --- bootstrap (the chicken-and-egg) ---------------------------------------
/**
 * Both first-admin paths. `grantRoleByEmail` is the shared, guard-railed core
 * used by the CLI (`apps/api/src/cli/admin.ts`) and by the ADMIN_EMAILS
 * allowlist; neither can promote an unverified or non-active account, because
 * neither has its own copy of the rules.
 */
export {
  grantRoleByEmail,
  listStaff,
  parseAdminEmails,
  promoteAllowlistedAdmin,
  registerBootstrapHook,
  type BootstrapHookResult,
  type GrantMechanism,
  type GrantOutcome,
} from './bootstrap.js';

// --- session revocation seam ------------------------------------------------
/**
 * See `sessions.ts`. Inject identity's `revokeAllFamiliesForUser` here (or via
 * `registerAdminRoutes(app, { revokeSessions })`) to make suspension and
 * force-logout terminate refresh-token families.
 */
export {
  resetSessionRevokerDiscovery,
  resolveSessionRevoker,
  revokeAllSessions,
  setSessionRevoker,
  type SessionRevoker,
} from './sessions.js';

// --- audit ------------------------------------------------------------------
/**
 * The admin trail's action vocabulary, published so the web console can label
 * audit rows without hard-coding strings, and so a future notifications lane
 * can subscribe to the ones that matter.
 */
export {
  recordAdminAudit,
  type AdminAuditAction,
  type AdminAuditEvent,
  type AdminAuditTargetType,
} from './audit.js';

// --- read surface for other modules ----------------------------------------
//
// Callers are responsible for authorizing the actor first — the policies above
// are exported for exactly that.

export {
  countActiveAdmins,
  defaultAdminDb,
  findAdminUserByEmail,
  findAdminUserById,
  getUserDetail,
  listAuditLog,
  listReports,
  listSellerApplications,
  listStaffUsers,
  listUsers,
  type AdminUserFilters,
  type AuditFilters,
  type ReportFilters,
  type SellerApplicationFilters,
} from './repository.js';

// --- types ------------------------------------------------------------------

export {
  ASSIGNABLE_ROLES,
  REPORT_REASONS,
  REPORT_STATUSES,
  REPORT_TARGET_TYPES,
  SELLER_APPLICATION_STATUSES,
  type AdminDb,
  type AdminLoginAttempt,
  type AdminUserDetail,
  type AdminUserResource,
  type AdminUserRow,
  type AuditLogEntry,
  type Page,
  type Report,
  type ReportReason,
  type ReportResource,
  type ReportStatus,
  type ReportTargetType,
  type Role,
  type RoleChangeResult,
  type SellerApplication,
  type SellerApplicationResource,
  type SellerApplicationStatus,
  type StatusChangeResult,
  type UserStatus,
} from './types.js';
