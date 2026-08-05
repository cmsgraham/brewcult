/**
 * Server-side gate for every /admin route.
 *
 * ── This is UX, not security ─────────────────────────────────────────────────
 * The API's policy layer (EF §3.2, `apps/api/src/lib/policy.ts`) is the only
 * authority on who may do what: every admin endpoint is default-deny and checks
 * `isStaff(actor)`, which requires a staff role AND `actor.mfa === true`. This
 * module exists so the right *screen* renders — a 404 for people who should not
 * know the console exists, an enrol prompt for staff without a two-factor
 * session — not to keep anyone out. Deleting it would leak no data; it would
 * only make the console feel broken. There is deliberately **no client-side role
 * check anywhere** in this feature: the browser is never trusted with the answer.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `_lib` is a Next private folder, so nothing here is routable.
 */
import { createAdminClient, gateFor, type AdminGate } from '../../../lib/admin-client';
import { canRestoreSession, serverApiFetch } from '../../../lib/server-api';

/**
 * Admin client bound to the RSC transport: cookies are forwarded explicitly and
 * a 401 is *not* silently refreshed (a server render cannot write the rotated
 * cookie back — see lib/server-api.ts).
 */
export const serverAdminClient = createAdminClient(serverApiFetch);

/**
 * A fourth screen: "we could not tell who you are, but this device says it has
 * a session". The refresh cookie is scoped to the auth path, so a page
 * navigation carries no credential once the 15-minute access cookie has
 * expired — and the console's answer to an unknown caller is a 404. An operator
 * who stepped away for twenty minutes therefore came back to "That page is not
 * here", which reads as a deleted feature rather than an expired token.
 */
export type AdminScreen = AdminGate | { state: 'restore' };

/**
 * Which console screen this request should get. Never throws: an API that is
 * down, unbuilt or hostile resolves to `unavailable`, which renders the ordinary
 * site 404 — the same page any bad URL gets.
 *
 * `restore` is checked only when the actor came back empty, so it can never
 * downgrade a real answer. And it leaks nothing: any signed-in visitor with an
 * expired access cookie sees the same line, and a non-staff one still lands on
 * the 404 once the session is restored.
 */
export async function adminGate(): Promise<AdminScreen> {
  const actor = await serverAdminClient.actor();
  if (!actor && (await canRestoreSession())) return { state: 'restore' };
  return gateFor(actor);
}
