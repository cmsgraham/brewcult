/**
 * Cookie transport for browsers — EF §2.3 / §3.3, backlog ID-04.
 *
 * Native and CLI clients use the same endpoints with `Authorization: Bearer`;
 * cookies exist so the web app never has to keep a token in JavaScript-reachable
 * storage (an XSS then cannot exfiltrate the session).
 *
 *  - HttpOnly on both CREDENTIAL cookies: script can neither read nor forge
 *    them. There is a third, `bc_session`, which is a readable flag holding no
 *    token — see `sessionHintCookieOptions` below for why.
 *  - Secure in production only, so http://localhost development still works.
 *  - SameSite=lax: top-level GET navigations keep the session (a link into the
 *    app stays logged in) while cross-site POST/PUT/DELETE do not carry it.
 *    Lax is not sufficient on its own, hence the CSRF token on mutations.
 *  - The refresh cookie is scoped to AUTH_COOKIE_PATH, so the long-lived
 *    credential is not attached to ordinary API traffic. That path is written
 *    as the BROWSER sees it (`/api/v1/auth`), not as the API routes it
 *    (`/v1/auth`) — Caddy strips `/api` server-side, and cookie path matching
 *    happens in the browser against the URL it actually requested.
 */
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyReply } from 'fastify';
import {
  ACCESS_COOKIE,
  ACCESS_TOKEN_TTL_SECONDS,
  LEGACY_AUTH_COOKIE_PATH,
  REFRESH_COOKIE,
  SESSION_HINT_COOKIE,
} from '../../lib/auth-plugin.js';
import { getEnv, isProduction } from '../../lib/env.js';
import type { IssuedSession } from './types.js';

function baseCookieOptions(): CookieSerializeOptions {
  const env = getEnv();
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    // COOKIE_DOMAIN=localhost would pin the cookie to the literal host in some
    // browsers; leaving it unset yields a host-only cookie, which is stricter.
    ...(isProduction() && env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
}

export function accessCookieOptions(): CookieSerializeOptions {
  return { ...baseCookieOptions(), path: '/', maxAge: ACCESS_TOKEN_TTL_SECONDS };
}

/**
 * A flag the BROWSER can read: "this device has a session worth restoring".
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * The refresh cookie is deliberately scoped to AUTH_COOKIE_PATH, so a page
 * navigation carries no credential at all once the 15-minute access cookie has
 * expired. The server therefore renders the signed-out shell, and the only
 * thing that can recover the session is the browser calling /auth/refresh.
 *
 * Without a hint, the only way to know whether that call is worth making is to
 * make it — on every cold page view, for every anonymous visitor and every
 * crawler. This cookie is how a returning person is distinguished from a first
 * one, cheaply.
 *
 * ── WHY IT IS SAFE TO EXPOSE ────────────────────────────────────────────────
 * It holds no token and grants nothing. Its entire content is `1`. Reading it
 * tells script exactly what the rendered page already says — whether to draw
 * "Sign out" or "Log in". Nothing on the server may treat it as authority, and
 * nothing does: `requireAuth` reads the access token and only the access token.
 *
 * It is NOT HttpOnly on purpose — a hint script cannot read is not a hint.
 */
export function sessionHintCookieOptions(expiresAt?: Date): CookieSerializeOptions {
  return {
    ...baseCookieOptions(),
    httpOnly: false,
    path: '/',
    ...(expiresAt ? { expires: expiresAt } : {}),
  };
}

export function refreshCookieOptions(expiresAt?: Date): CookieSerializeOptions {
  return {
    ...baseCookieOptions(),
    path: getEnv().AUTH_COOKIE_PATH,
    ...(expiresAt ? { expires: expiresAt } : {}),
  };
}

export function setSessionCookies(reply: FastifyReply, session: IssuedSession): void {
  reply.setCookie(ACCESS_COOKIE, session.accessToken, accessCookieOptions());
  reply.setCookie(
    REFRESH_COOKIE,
    session.refreshToken,
    refreshCookieOptions(session.refreshTokenExpiresAt),
  );
  // Outlives the access cookie on purpose: its whole job is to be there after
  // the access cookie has gone, so the browser knows a refresh is worth trying.
  reply.setCookie(SESSION_HINT_COOKIE, '1', sessionHintCookieOptions(session.refreshTokenExpiresAt));
}

export function clearSessionCookies(reply: FastifyReply): void {
  reply.clearCookie(ACCESS_COOKIE, { ...baseCookieOptions(), path: '/' });
  reply.clearCookie(SESSION_HINT_COOKIE, { ...baseCookieOptions(), httpOnly: false, path: '/' });
  reply.clearCookie(REFRESH_COOKIE, { ...baseCookieOptions(), path: getEnv().AUTH_COOKIE_PATH });
  // Also clear the pre-fix scope. Browsers that signed in before the path was
  // corrected still hold a bc_refresh at `/v1/auth`; it can never be sent, but
  // logout should not leave a stale credential sitting in the jar.
  reply.clearCookie(REFRESH_COOKIE, { ...baseCookieOptions(), path: LEGACY_AUTH_COOKIE_PATH });
}

/** True when this request carries ambient cookie authority (→ needs CSRF). */
export function hasSessionCookie(cookies: Record<string, string | undefined> | undefined): boolean {
  // The hint is deliberately NOT consulted here. This answers "does this
  // request carry ambient authority the CSRF guard must cover", and a flag that
  // grants nothing carries none.
  return Boolean(cookies?.[ACCESS_COOKIE] ?? cookies?.[REFRESH_COOKIE]);
}
