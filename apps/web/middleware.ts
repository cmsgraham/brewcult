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
 * ── THE ONE RULE: A REQUESTED URL IS NEVER REDIRECTED ───────────────────────
 * The cookie guesses for a FIRST visit and never again. That is the whole rule,
 * and it exists because the obvious alternative — "remember their language and
 * always send them there" — breaks the language switcher: clicking English on a
 * Spanish page requests `/discover`, the cookie says `es`, and the middleware
 * bounces them straight back. The switcher looked dead while working perfectly.
 *
 * It breaks shared links the same way. Sending somebody `/coffee/x` and having
 * them land on `/es/coffee/x` because of a cookie they forgot they had is the
 * kind of thing that makes people distrust a site's URLs.
 *
 * So: no cookie at all + an unprefixed URL is the only case where
 * `Accept-Language` gets a vote. After that the URL is the truth, and the
 * cookie merely follows it — which is what makes it a memory of a choice
 * rather than an override of one.
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
  const remembered = request.cookies.get(LOCALE_COOKIE)?.value;

  /** Records what they are actually reading, so the memory follows the URL. */
  const remember = (response: NextResponse, locale: string): NextResponse => {
    if (remembered !== locale) {
      response.cookies.set(LOCALE_COOKIE, locale, {
        path: '/',
        maxAge: LOCALE_COOKIE_MAX_AGE,
        sameSite: 'lax',
      });
    }
    return response;
  };

  // An explicit `/es/…`. Serve it and remember it — this is how a shared link
  // teaches the site what its recipient reads.
  if (isLocale(prefix)) {
    return remember(
      withCsp(NextResponse.next({ request: { headers: requestHeaders } })),
      prefix,
    );
  }

  // Unprefixed, and they have never been here: the only moment the browser's
  // Accept-Language gets a vote.
  if (!isLocale(remembered)) {
    const guessed = localeFromAcceptLanguage(request.headers.get('accept-language'));
    if (guessed !== DEFAULT_LOCALE && LOCALES.includes(guessed)) {
      const url = request.nextUrl.clone();
      url.pathname = `/${guessed}${pathname === '/' ? '' : pathname}`;
      return remember(withCsp(NextResponse.redirect(url)), guessed);
    }
  }

  // Unprefixed IS the English URL. Serve it — never redirect a URL somebody
  // asked for — and let the memory follow what they are reading.
  const url = request.nextUrl.clone();
  url.pathname = `/${DEFAULT_LOCALE}${pathname === '/' ? '' : pathname}`;
  return remember(
    withCsp(NextResponse.rewrite(url, { request: { headers: requestHeaders } })),
    DEFAULT_LOCALE,
  );
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
