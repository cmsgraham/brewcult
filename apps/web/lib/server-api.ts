/**
 * Server-side (RSC / route handler) API access.
 *
 * Separate from lib/api.ts because it imports `next/headers`, which must never
 * reach a client bundle. Two differences from the browser path:
 *
 *  1. Cookies are forwarded explicitly — an RSC `fetch` carries no cookie jar.
 *  2. No silent-refresh retry: a server render cannot write a rotated refresh
 *     cookie back to the browser, so a 401 here means "send them to /login" and
 *     the *browser* does the refresh dance on its next call.
 */
import 'server-only';
import { cookies } from 'next/headers';
import {
  ApiError,
  SESSION_HINT_COOKIE,
  apiFetch,
  type ApiRequestOptions,
  type SessionUser,
} from './api';

export async function serverApiFetch<T = unknown>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();

  const headers = new Headers(options.headers);
  if (cookieHeader && !headers.has('cookie')) headers.set('cookie', cookieHeader);

  return apiFetch<T>(path, {
    ...options,
    headers,
    refreshOn401: false,
    // Authenticated reads are per-request; catalog callers opt back in to caching.
    cache: options.cache ?? 'no-store',
  });
}

/**
 * The signed-in user, or null. Never throws — an unauthenticated visitor is a
 * normal state, not an error.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    // `/api/v1/users/me` — the same path lib/api.ts uses in the browser. This
    // read `/api/me`, which strips to `/me` and 404s: the route lives under
    // `/v1/users`. Because the catch below turns ANY failure into "signed out",
    // the effect was that every server-rendered page decided you were logged
    // out no matter how good your cookies were — you would sign in, land on the
    // app, then be bounced straight back to /login by the first server render.
    return await serverApiFetch<SessionUser>('/api/v1/users/me');
  } catch (error) {
    // 401/403 is the ordinary "not signed in" answer — silent by design.
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      return null;
    }
    // Anything else still degrades to signed-out rather than 500-ing the page,
    // but it is NOT normal and must not be silent. A wrong path, a DNS failure
    // or a dead API is indistinguishable from a logged-out visitor on screen,
    // which is exactly how the bug above survived: the symptom was "login does
    // not work", and nothing anywhere said why.
    // Next throws DynamicServerError while probing whether a route can be
    // prerendered — `cookies()` is exactly what it is looking for. That is
    // control flow, not a fault: the route is correctly marked dynamic and
    // rendered per-request. Logging it would print a scary line on every build
    // and teach everyone to ignore this message, which would defeat the point
    // of having it.
    const digest = (error as { digest?: string } | null)?.digest;
    if (digest !== 'DYNAMIC_SERVER_USAGE') {
      // EF §7.2 wants structured pino logs, but the web container has no logger
      // and this module is `server-only`, so this writes to the container's
      // stdout — exactly where an operator looks. The alternative is silence,
      // and silence here is what let a 404 masquerade as "signed out" for a
      // whole session while every page quietly redirected to /login.
      // eslint-disable-next-line no-console
      console.error('[server-api] session lookup failed — treating as signed out:', error);
    }
    return null;
  }
}

/**
 * Is a session cookie present?
 *
 * Presence, not validity — and that distinction is deliberate. This exists so
 * the nav can decide whether to draw "Sign out" without an API round trip on
 * every single page render. A stale cookie means somebody sees the control and
 * gets sent to /login when they use it, which is the correct destination
 * anyway. Anything that GRANTS access must still verify the token properly;
 * this only decides whether to draw a button.
 */
export async function hasSessionCookie(): Promise<boolean> {
  const jar = await cookies();
  // The hint counts here. It is set for as long as the refresh token lives and
  // is visible on page navigations, which is exactly when the two credential
  // cookies are not — that combination is what made every returning visitor
  // render as a stranger.
  return jar.has('bc_access') || jar.has('bc_refresh') || jar.has(SESSION_HINT_COOKIE);
}

/**
 * The session lookup failed, but this device claims to have one.
 *
 * A page in this state must NOT redirect to /login: the refresh cookie is
 * scoped to the auth path, so the browser is the only party that can prove the
 * session still exists, and a redirect navigates away before it gets the
 * chance. Render the restore screen instead and let the browser answer.
 */
export async function canRestoreSession(): Promise<boolean> {
  const jar = await cookies();
  // The access cookie's absence is the whole signal. It and the token inside it
  // expire together, so "no access cookie but a hint" means precisely: this
  // device has a session, and the credential that could prove it was not sent
  // with this request. An access cookie that IS present and still gets refused
  // is a real refusal — revoked, demoted, deleted — and belongs at /login.
  return !jar.has('bc_access') && jar.has(SESSION_HINT_COOKIE);
}
