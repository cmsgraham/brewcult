/**
 * IDENTITY MODULE — PUBLIC INTERFACE (EF §1.2, backlog ID-01..ID-12).
 *
 * This file is the module's entire contract. `.dependency-cruiser.cjs` makes any
 * import of `modules/identity/<anything-else>` from outside a hard error, so
 * everything another lane needs must appear below — and nothing that appears
 * below can be changed without noticing who depends on it.
 *
 * Wiring in `apps/api/src/app.ts` is two lines:
 *
 *     import { registerIdentityRoutes } from './modules/identity/index.js';
 *     await registerIdentityRoutes(app);
 *
 * That single call installs the request-actor plugin (app-wide), CSRF
 * protection, the identity policies, the `/v1/auth`, `/v1/users` and
 * `/auth/google` route trees, and — when GOOGLE_CLIENT_ID is set — Google
 * sign-in. It is safe to call on an app that already registered `authPlugin`.
 */
import fastifyCsrf from '@fastify/csrf-protection';
import type { FastifyInstance } from 'fastify';
import { authPlugin } from '../../lib/auth-plugin.js';
import { isProduction } from '../../lib/env.js';
import { registerIdentityPolicies } from './policies.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerGoogleRoutes } from './routes/google.js';
import { registerMfaRoutes } from './routes/mfa.js';
import { registerProfileRoutes } from './routes/profile.js';
import { registerSessionRoutes } from './routes/sessions.js';

// --- types other modules may depend on --------------------------------------
export type {
  AuthProvider,
  GoogleProfile,
  IssuedSession,
  PublicUserProfile,
  Role,
  SelfUserProfile,
  SessionResource,
  SessionSummary,
  UserResource,
  UserRow,
  UserStatus,
} from './types.js';

// --- authorization ----------------------------------------------------------
export {
  SESSION_RESOURCE,
  USER_RESOURCE,
  registerIdentityPolicies,
  sessionPolicy,
  userPolicy,
} from './policies.js';

/**
 * Read a user (as a policy resource) without reaching into the module's SQL.
 * Other modules that need to authorize against a user record use these rather
 * than querying `users` themselves — table ownership is a module boundary.
 */
export {
  findUserById,
  findUserByHandle,
  toPublicProfile,
  toSelfProfile,
  toUserResource,
} from './repo.js';

// --- audit ------------------------------------------------------------------
/**
 * Other modules log their own permission-relevant events through this. The
 * table is append-only by database trigger; there is intentionally no update or
 * delete counterpart (EF §3.7).
 */
export { recordAuditEvent, type AuditAction, type AuditEvent } from './audit.js';

// --- MFA enforcement --------------------------------------------------------
/**
 * `isStaff()` in lib/policy.ts already refuses actors without `actor.mfa`.
 * `mfaRequiredForRole()` answers the complementary product question: should
 * this user be prompted to finish enrolling?
 */
export { MFA_REQUIRED_ROLES, mfaRequiredForRole } from './mfa.js';

// --- integration seams ------------------------------------------------------
/** Installs the SMTP transport for identity mail (notifications lane). */
export { setIdentityMailer, type IdentityMailMessage, type IdentityMailer } from './mailer.js';
/** Replaces the offline common-password list with e.g. an HIBP client. */
export { setBreachChecker, type BreachChecker } from './passwords.js';
/** CSRF preHandler for other modules' cookie-authenticated mutations. */
export { csrfGuard } from './routes/guards.js';

/** Pure function behind Google account linking — exported for the trust lane. */
export { resolveGoogleIdentity, type GoogleLinkOutcome } from './google.js';

export const IDENTITY_AUTH_PREFIX = '/v1/auth';
export const IDENTITY_USERS_PREFIX = '/v1/users';

/**
 * Registers everything the identity module owns.
 *
 * Route map:
 *   POST   /v1/auth/register                 202, anti-enumeration
 *   POST   /v1/auth/verify-email             confirm the 15-minute code
 *   POST   /v1/auth/verify-email/resend      202, anti-enumeration
 *   POST   /v1/auth/login                    tokens, or an MFA challenge
 *   POST   /v1/auth/mfa/verify               second leg of an MFA login
 *   POST   /v1/auth/refresh                  rotation + family reuse detection
 *   POST   /v1/auth/logout                   revokes the current family
 *   POST   /v1/auth/password/forgot          202, anti-enumeration
 *   POST   /v1/auth/password/reset           single-use token
 *   POST   /v1/auth/password/change          authenticated
 *   POST   /v1/auth/email/change[/confirm]   authenticated, notifies old address
 *   GET    /v1/auth/csrf                     double-submit token
 *   GET    /v1/auth/sessions                 own device list
 *   DELETE /v1/auth/sessions/:familyId       revoke one
 *   DELETE /v1/auth/sessions                 revoke all
 *   POST   /v1/auth/mfa/enrol|confirm|disable|recovery-codes
 *   GET    /v1/users/me
 *   GET    /v1/users/:handle                 public projection
 *   PATCH  /v1/users/:id                     self only
 *   DELETE /v1/users/:id                     self only
 *   PATCH  /v1/users/:id/role                staff + MFA, audit-logged
 *   GET    /auth/google, /auth/google/callback   (only when configured)
 */
export async function registerIdentityRoutes(app: FastifyInstance): Promise<void> {
  await app.register(authPlugin);

  if (!app.hasReplyDecorator('generateCsrf')) {
    await app.register(fastifyCsrf, {
      sessionPlugin: '@fastify/cookie',
      cookieKey: '_csrf',
      cookieOpts: {
        path: '/',
        // NOT HttpOnly: the double-submit pattern requires the client to read
        // this value and echo it back in a header. It is not a credential — it
        // is only useful together with a cookie the attacker cannot read.
        httpOnly: false,
        sameSite: 'lax',
        secure: isProduction(),
      },
      getToken: (request) => {
        const header = request.headers['x-csrf-token'];
        return Array.isArray(header) ? header[0] : header;
      },
    });
  }

  registerIdentityPolicies();

  await app.register(
    async (scope) => {
      registerAuthRoutes(scope);
      registerSessionRoutes(scope);
      registerMfaRoutes(scope);
    },
    { prefix: IDENTITY_AUTH_PREFIX },
  );

  await app.register(
    async (scope) => {
      registerProfileRoutes(scope);
    },
    { prefix: IDENTITY_USERS_PREFIX },
  );

  // Root-mounted so the redirect URI matches the Google console entry exactly.
  registerGoogleRoutes(app);
}
