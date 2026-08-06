import { NextResponse, type NextRequest } from 'next/server';
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  isLocale,
  localeFromAcceptLanguage,
} from './lib/i18n';

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
 * ── AND THE LOCALE, because both need the same request ──────────────────────
 * Two languages share one route tree under `app/[locale]`. English is
 * unprefixed, so `/discover` is REWRITTEN to `/en/discover` internally while
 * the URL the visitor sees never changes — that is what keeps every already
 * indexed URL working.
 *
 * A first-time visitor whose browser asks for Spanish is REDIRECTED to `/es/…`
 * once, and the choice is remembered in a cookie. Redirect rather than rewrite,
 * because the language a person reads should be in the URL they can bookmark
 * and send to somebody else. Anybody who has chosen a language is never
 * redirected again — the cookie beats the header, and an explicit prefix beats
 * both.
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
/** Paths that are not pages and must never be rewritten or redirected. */
const PASS_THROUGH = /^\/(?:api|_next|icons|brand|favicon|robots\.txt|sitemap\.xml|manifest\.webmanifest|og-|sw\.js)/;

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const nonce = btoa(crypto.randomUUID());
  const isDev = process.env.NODE_ENV !== 'production';

  const csp = [
    "default-src 'self'",
    // 'unsafe-eval' is dev-only: the Next dev server compiles in the browser.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    // The media origin is a separate, cookie-less host. In development that is
    // the local MinIO container, so images would otherwise be CSP-blocked on
    // every dev machine while working fine in production — the worst kind of
    // environment-only bug.
    `img-src 'self' data: blob: https://media.brewcult.coffee${
      process.env.NODE_ENV === 'production' ? '' : ' http://localhost:9000'
    }`,
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  // The path as the VISITOR sees it, for the language switcher and the
  // canonical/hreflang tags — by the time a page renders, a rewrite has already
  // hidden the difference between `/discover` and `/en/discover`.
  requestHeaders.set('x-pathname', pathname);

  const withCsp = (response: NextResponse): NextResponse => {
    response.headers.set('Content-Security-Policy', csp);
    return response;
  };

  if (PASS_THROUGH.test(pathname)) {
    return withCsp(NextResponse.next({ request: { headers: requestHeaders } }));
  }

  const prefix = pathname.split('/')[1];

  // Already asking for a language explicitly: serve it, and remember it. This
  // is how a shared `/es/…` link teaches the site what the recipient reads.
  if (isLocale(prefix)) {
    const response = withCsp(NextResponse.next({ request: { headers: requestHeaders } }));
    if (request.cookies.get(LOCALE_COOKIE)?.value !== prefix) {
      response.cookies.set(LOCALE_COOKIE, prefix, {
        path: '/',
        maxAge: LOCALE_COOKIE_MAX_AGE,
        sameSite: 'lax',
      });
    }
    return response;
  }

  // Unprefixed. Either this person wants English, or they have never been here
  // and their browser is asking for something else.
  const chosen = request.cookies.get(LOCALE_COOKIE)?.value;
  const preferred = isLocale(chosen)
    ? chosen
    : localeFromAcceptLanguage(request.headers.get('accept-language'));

  if (preferred !== DEFAULT_LOCALE && LOCALES.includes(preferred)) {
    const url = request.nextUrl.clone();
    url.pathname = `/${preferred}${pathname === '/' ? '' : pathname}`;
    const response = withCsp(NextResponse.redirect(url));
    response.cookies.set(LOCALE_COOKIE, preferred, {
      path: '/',
      maxAge: LOCALE_COOKIE_MAX_AGE,
      sameSite: 'lax',
    });
    return response;
  }

  // English, served from the unprefixed URL it was indexed under.
  const url = request.nextUrl.clone();
  url.pathname = `/${DEFAULT_LOCALE}${pathname === '/' ? '' : pathname}`;
  return withCsp(NextResponse.rewrite(url, { request: { headers: requestHeaders } }));
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
