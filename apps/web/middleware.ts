import { NextResponse, type NextRequest } from 'next/server';

/**
 * Per-request CSP nonce (deployment_guide §5.3, backlog F-15 — web half).
 *
 * The edge policy has **no `unsafe-inline` for scripts**. The App Router still
 * emits inline bootstrap/flight scripts, so those need a nonce or the page dies
 * on hydration. Next generates the nonce onto its own inline scripts *only* if
 * it finds one in the `Content-Security-Policy` request header — which is what
 * this middleware sets, alongside the matching response header.
 *
 * `'strict-dynamic'` lets the nonced bootstrap load the /_next chunks it needs
 * without enumerating them.
 *
 * ── Note for infra ────────────────────────────────────────────────────────────
 * Caddy's `header Content-Security-Policy "…"` *replaces* this one, and the
 * static policy has no nonce. For the app to work under CSP, the edge must let
 * the app's header through for the web upstream (e.g. drop `script-src` from the
 * Caddy CSP for `brewcult.coffee`, or set the header only where the app does not
 * — `header ?Content-Security-Policy` sets a default only when absent). The rest
 * of the policy below is a byte-for-byte copy of §5.3 so nothing else changes.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const isDev = process.env.NODE_ENV !== 'production';

  const csp = [
    "default-src 'self'",
    // 'unsafe-eval' is dev-only: the Next dev server compiles in the browser.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://media.brewcult.coffee",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and prefetches — hashing a nonce into a
     * cacheable /_next/static response would defeat the cache and the point.
     */
    {
      source: '/((?!_next/static|_next/image|favicon.ico|icons/|brand/|og-1200x630.png).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
