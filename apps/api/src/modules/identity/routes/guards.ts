/**
 * Cross-site request forgery defence for cookie transport — EF §3.3, ID-04.
 *
 * Two independent layers, because each one has a known gap:
 *
 *  1. ORIGIN CHECK. Browsers attach `Origin` to every cross-origin request and
 *     to all same-origin non-GET requests, and script cannot forge it. A
 *     mismatched origin is refused outright. This covers *login CSRF* (forcing
 *     a victim's browser to authenticate as the attacker), which a token check
 *     alone cannot: a victim who has never visited the site holds no token and
 *     no cookie, so there is nothing for a token check to compare. Non-browser
 *     clients (mobile, CLI, server-to-server) send no `Origin` and are
 *     unaffected.
 *
 *  2. DOUBLE-SUBMIT TOKEN (@fastify/csrf-protection) on any request that
 *     carries our session cookies — i.e. exactly the requests with ambient
 *     authority. `GET /v1/auth/csrf` issues the token; clients echo it in
 *     `x-csrf-token`. Requests authenticated with `Authorization: Bearer` have
 *     no ambient authority and are skipped.
 *
 * SameSite=lax on the session cookies is a third layer, but it is a default the
 * user's browser chooses to honour, not a control we enforce — hence both of
 * the above.
 */
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { getEnv } from '../../../lib/env.js';
import { forbidden } from '../../../lib/errors.js';
import { hasSessionCookie } from '../cookies.js';

let allowedOrigins: Set<string> | null = null;

function originAllowlist(): Set<string> {
  if (allowedOrigins) return allowedOrigins;
  const env = getEnv();
  const set = new Set<string>();
  for (const url of [env.APP_URL, env.API_URL]) {
    if (!url) continue;
    try {
      set.add(new URL(url).origin);
    } catch {
      // A malformed APP_URL/API_URL must not silently widen the allowlist.
    }
  }
  allowedOrigins = set;
  return set;
}

/** Test-only: re-reads APP_URL/API_URL. */
export function resetOriginAllowlist(): void {
  allowedOrigins = null;
}

function checkOrigin(request: FastifyRequest): void {
  const origin = request.headers.origin;
  if (typeof origin !== 'string' || origin === '' || origin === 'null') return; // not a browser, or opaque
  if (!originAllowlist().has(origin)) {
    throw forbidden('Cross-origin request refused.');
  }
}

/**
 * preHandler for every state-changing identity route.
 */
export const csrfGuard: preHandlerHookHandler = function csrfGuardHandler(
  request: FastifyRequest,
  reply: FastifyReply,
  done: (err?: Error) => void,
): void {
  try {
    checkOrigin(request);
  } catch (err) {
    done(err as Error);
    return;
  }

  if (!hasSessionCookie(request.cookies)) {
    done();
    return;
  }

  request.server.csrfProtection(request, reply, done);
};
