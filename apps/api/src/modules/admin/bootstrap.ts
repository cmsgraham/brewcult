/**
 * FIRST-ADMIN BOOTSTRAP — the chicken-and-egg at the heart of an operator surface.
 *
 * THE PROBLEM
 *   Changing a role requires a staff actor with MFA (`isStaff()` in
 *   lib/policy.ts refuses `actor.mfa !== true`). On a fresh install there is no
 *   staff account, so there is nobody who may create one. Every role-change
 *   route is correct and the system is, correctly, unadministrable.
 *
 * THE TWO WAYS OUT (both implemented; both refuse an unverified email)
 *
 *   (a) ADMIN_EMAILS ALLOWLIST — an operator-controlled environment variable
 *       (already declared in lib/env.ts, unused until now). When someone whose
 *       VERIFIED email is on that list authenticates, they are promoted to
 *       admin and a `system`-actor audit row is written. Trigger points are the
 *       two identity endpoints that PROVE control of the address:
 *
 *         POST /v1/auth/verify-email   2xx → the address was just confirmed
 *         POST /v1/auth/login          2xx → password verified AND (login
 *                                      refuses unverified accounts outright)
 *                                      the address is already confirmed
 *
 *       This is implemented as a Fastify `onResponse` hook that this module
 *       registers on the shared app — NOT as an edit to identity. Identity's
 *       files are untouched. The hook reads the request body (which carries the
 *       email on both routes) and the response status; it never inspects
 *       credentials, never mutates the response, and its failure is logged and
 *       swallowed, because a bootstrap problem must not turn a successful login
 *       into a 500.
 *
 *       WHY `onResponse` AND NOT A CALL FROM IDENTITY: the seam that requires
 *       zero changes in another lane is the seam that ships. If the identity
 *       lane would rather call this directly, `promoteAllowlistedAdmin()` is
 *       exported for exactly that and the hook can be dropped — one line in
 *       `routes/auth.ts` after `markEmailVerified` / after a successful login:
 *
 *           await promoteAllowlistedAdmin(defaultAdminDb, user.email);
 *
 *   (b) BREAK-GLASS CLI — `npm run admin:grant -- --email x@y.z --role admin`
 *       (apps/api/src/cli/admin.ts). Connects with DATABASE_URL, refuses an
 *       unverified address, writes the same `system` audit row. This is the
 *       documented recovery path when nobody can log in at all, and it is the
 *       one that works when the operator has already enrolled MFA on an
 *       unprivileged account.
 *
 * ── SECURITY PROPERTIES (each one is a test) ────────────────────────────────
 *   * NEVER promotes an unverified email. This is the whole ballgame: with an
 *     unverified address, "admin@brewcult.coffee is on the allowlist" would let
 *     anyone who can type that address into the signup form become an admin.
 *     Both paths check `email_verified_at IS NOT NULL` and refuse otherwise.
 *   * NEVER promotes a non-active account. A suspended account on the allowlist
 *     stays suspended; otherwise suspension would be undone by an env var.
 *   * Idempotent. An account already holding the role is a no-op with no audit
 *     row — otherwise every login by an admin would append to an immutable
 *     table forever.
 *   * The grant is INERT until MFA is enrolled. `isStaff()` requires
 *     `actor.mfa === true`, so a freshly bootstrapped admin still cannot reach
 *     `/v1/admin/**` until they complete TOTP enrolment and log in again. That
 *     is not a bug to route around — it is EF §3.2's "MFA enforced" holding
 *     even for the founder. The README spells out the full first-run sequence.
 *   * The promotion applies to the NEXT token minted. The access token already
 *     in flight carries the old role claim; a refresh (or a new login) re-reads
 *     `users.role` and picks the new one up.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getEnv } from '../../lib/env.js';
import { mfaRequiredForRole, setUserRole } from '../identity/index.js';
import { recordAdminAudit } from './audit.js';
import {
  countActiveAdmins,
  execOf,
  findAdminUserByEmail,
  listStaffUsers,
} from './repository.js';
import type { AdminDb, AdminUserRow, Role } from './types.js';

/** How a grant was triggered — recorded in the audit payload. */
export type GrantMechanism = 'admin_emails_allowlist' | 'cli';

export type GrantOutcome =
  | { status: 'granted'; user: AdminUserRow; previous_role: Role; mfa_required: boolean }
  | { status: 'already_granted'; user: AdminUserRow }
  | { status: 'user_not_found'; email: string }
  | { status: 'email_unverified'; user: AdminUserRow }
  | { status: 'account_not_active'; user: AdminUserRow };

/**
 * Parses `ADMIN_EMAILS`. Comma-, semicolon- or whitespace-separated; empty
 * entries dropped; lower-cased for comparison (`users.email` is citext, so the
 * database agrees).
 */
export function parseAdminEmails(raw: string): Set<string> {
  return new Set(
    raw
      .split(/[,;\s]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0 && entry.includes('@')),
  );
}

/**
 * THE shared grant path. Both bootstrap mechanisms and the CLI funnel through
 * this one function, so the refusals below cannot be forgotten by one caller.
 *
 * `actorId` is null for both bootstrap paths (system action, 0002's convention
 * for `audit_log.actor_id`); it is never a user id, because no user authorised
 * this — the environment or the machine's operator did.
 */
export async function grantRoleByEmail(
  db: AdminDb,
  input: { email: string; role: Role; mechanism: GrantMechanism },
): Promise<GrantOutcome> {
  const email = input.email.trim().toLowerCase();
  const user = await findAdminUserByEmail(db, email);
  if (!user) return { status: 'user_not_found', email };

  // HARD GATE. Do not move, do not add an "unless" — see the security note.
  if (user.email_verified_at === null) return { status: 'email_unverified', user };

  if (user.status !== 'active') return { status: 'account_not_active', user };

  if (user.role === input.role) return { status: 'already_granted', user };

  const previous_role = user.role;
  const updated = await setUserRole(execOf(db), user.id, input.role);
  if (!updated) return { status: 'user_not_found', email };

  await recordAdminAudit(db, {
    actorId: null, // system
    action: 'admin.bootstrap_granted',
    targetType: 'user',
    targetId: user.id,
    payload: {
      mechanism: input.mechanism,
      email,
      from_role: previous_role,
      to_role: input.role,
      mfa_required: mfaRequiredForRole(input.role),
    },
  });

  return {
    status: 'granted',
    user: { ...user, role: input.role },
    previous_role,
    mfa_required: mfaRequiredForRole(input.role),
  };
}

/**
 * The ADMIN_EMAILS path. Promotes to `admin` only, and only for an address that
 * is actually on the list — the caller has usually checked already, but this
 * function is exported for identity to call directly, so it re-checks rather
 * than trusting its caller.
 */
export async function promoteAllowlistedAdmin(
  db: AdminDb,
  email: string,
  allowlist?: Set<string>,
): Promise<
  | GrantOutcome
  | { status: 'not_allowlisted'; email: string }
  | { status: 'bootstrap_closed'; existing_admins: number }
> {
  const normalised = email.trim().toLowerCase();
  const list = allowlist ?? parseAdminEmails(getEnv().ADMIN_EMAILS);
  if (!list.has(normalised)) return { status: 'not_allowlisted', email: normalised };

  // THE BOOTSTRAP CLOSES ITSELF once the platform has an active admin.
  //
  // ADMIN_EMAILS exists to solve exactly one problem: a fresh install has no
  // administrator and no way to create one, because granting a role requires
  // being staff already. The moment that deadlock is broken the variable has
  // done its job — and every later promotion it performs is pure risk.
  //
  // Relying on the operator to delete the variable afterwards (which is what
  // the runbook used to say) means the safety of the deployment depends on
  // somebody remembering a manual step, on a box where an old .env.prod tends
  // to be copied forward. Anyone who could ever receive mail at a listed
  // address — an alias, a former colleague's forwarded account, a mailbox
  // recreated on a domain you still own — would be handed admin on their next
  // sign-in, silently and with no approval step.
  //
  // The CLI (`admin:grant`) deliberately does NOT go through here: it is the
  // break-glass path for when nobody can sign in, it needs the database
  // credentials to run, and it must keep working after this gate closes.
  const existingAdmins = await countActiveAdmins(db);
  if (existingAdmins > 0) return { status: 'bootstrap_closed', existing_admins: existingAdmins };

  return grantRoleByEmail(db, {
    email: normalised,
    role: 'admin',
    mechanism: 'admin_emails_allowlist',
  });
}

/** Staff roster, for `admin:list`. */
export function listStaff(db: AdminDb): Promise<AdminUserRow[]> {
  return listStaffUsers(db);
}

// ---------------------------------------------------------------------------
// The zero-touch hook
// ---------------------------------------------------------------------------

/**
 * Identity endpoints whose 2xx response proves the caller controls the email
 * address in the request body. Adding a path here is a security decision: it
 * must be a route that cannot answer 2xx without the address being both present
 * in the body AND proven.
 */
const BOOTSTRAP_TRIGGERS = new Set(['/v1/auth/login', '/v1/auth/verify-email']);

/**
 * Routes that prove the address a different way: no request body, because they
 * are a browser redirect, so identity publishes `request.provenEmail` instead.
 *
 * Google's callback belongs here. Without it ADMIN_EMAILS does nothing at all
 * on a deployment whose operator signs in with Google — the console simply
 * stays unreachable, with nothing to explain why.
 */
const PROVEN_EMAIL_TRIGGERS = new Set(['/auth/google/callback']);

export interface BootstrapHookResult {
  installed: boolean;
  /** Number of addresses on the allowlist — logged, never the addresses. */
  allowlisted: number;
}

function emailFromBody(request: FastifyRequest): string | null {
  const body = request.body as { email?: unknown } | undefined;
  return typeof body?.email === 'string' && body.email.length > 0 ? body.email : null;
}

/**
 * The address this request is allowed to bootstrap on, or null.
 *
 * Two shapes, one rule: the route must not be able to reach a success status
 * without the address having been PROVEN. POST routes carry it in a body they
 * authenticated against; the OAuth callback carries it on `provenEmail`, set
 * only after Google asserted the address and asserted it verified.
 */
function bootstrapEmail(request: FastifyRequest, path: string): string | null {
  if (request.method === 'POST' && BOOTSTRAP_TRIGGERS.has(path)) return emailFromBody(request);
  if (request.method === 'GET' && PROVEN_EMAIL_TRIGGERS.has(path)) {
    return request.provenEmail ?? null;
  }
  return null;
}

/**
 * Installs the ADMIN_EMAILS hook on the shared app. No-op when ADMIN_EMAILS is
 * empty — "feature cleanly disabled" is the env convention (lib/env.ts), and an
 * always-on hook that queries the database after every login would be a real
 * cost for a feature nearly every deployment turns off after first run.
 */
export function registerBootstrapHook(app: FastifyInstance, db: AdminDb): BootstrapHookResult {
  const allowlist = parseAdminEmails(getEnv().ADMIN_EMAILS);
  if (allowlist.size === 0) return { installed: false, allowlisted: 0 };

  app.addHook('onResponse', async (request, reply) => {
    try {
      // 2xx for the POST routes; the OAuth callback answers 302 on success, so
      // a 2xx-only gate would silently skip it. `provenEmail` is the real proof
      // in that case — it is set only after the address was verified — and a
      // failed callback redirects without ever setting it.
      const ok =
        (reply.statusCode >= 200 && reply.statusCode < 300) ||
        (reply.statusCode >= 300 && reply.statusCode < 400 && request.provenEmail !== undefined);
      if (!ok) return;

      const path = request.url.split('?')[0] ?? '';
      const email = bootstrapEmail(request, path);
      if (email === null) return;
      if (!allowlist.has(email.trim().toLowerCase())) return;

      const outcome = await promoteAllowlistedAdmin(db, email, allowlist);
      if (outcome.status === 'granted') {
        request.log.warn(
          {
            bootstrap: 'admin_emails',
            user_id: outcome.user.id,
            from_role: outcome.previous_role,
            to_role: outcome.user.role,
          },
          'ADMIN_EMAILS bootstrap promoted an account to admin — remove the address from ' +
            'ADMIN_EMAILS once the operator has enrolled MFA',
        );
      } else if (outcome.status === 'email_unverified') {
        request.log.warn(
          { bootstrap: 'admin_emails', user_id: outcome.user.id },
          'ADMIN_EMAILS bootstrap REFUSED: address is not verified',
        );
      }
    } catch (err) {
      // The response has already been sent. A bootstrap failure is an
      // operational problem to investigate, never a reason to fail the request
      // that triggered it.
      request.log.error({ err }, 'ADMIN_EMAILS bootstrap hook failed');
    }
  });

  return { installed: true, allowlisted: allowlist.size };
}
