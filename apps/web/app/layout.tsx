import { type Metadata, type Viewport } from 'next';
import { Space_Grotesk } from 'next/font/google';
import { type ReactNode } from 'react';
import { SiteFooter } from '../components/site-footer';
import { SiteNav } from '../components/site-nav';
import { brand } from '../lib/brand';
import { fetchClientConfig } from '../lib/client-config';
import { visibleNavItems } from '../lib/nav';
import { hasSessionCookie } from '../lib/server-api';
import './globals.css';

/**
 * Space Grotesk is the brand typeface (docs/brand/wordmark/WORDMARK-NOTES.md,
 * SIL OFL 1.1). next/font/google downloads and **self-hosts** it at build time:
 * no binary font file lands in the repo, no request goes to Google at runtime,
 * and it satisfies `font-src 'self'` under the deployment_guide §5.3 CSP.
 *
 * The logo files still carry outlined paths — live text is UI copy only, never
 * the wordmark.
 */
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-brand',
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://brewcult.coffee';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'BrewCult — brewing intelligence for people who love coffee',
    template: '%s · BrewCult',
  },
  description:
    'Log your brews, dial in your grinder and find coffee worth drinking. Beginners welcome — every great brewer started with bitter coffee.',
  applicationName: 'BrewCult',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '48x48' },
      { url: '/icons/icon-192.png', type: 'image/png', sizes: '192x192' },
      { url: '/icons/icon-512.png', type: 'image/png', sizes: '512x512' },
    ],
    apple: [{ url: '/icons/apple-touch-icon-180.png', sizes: '180x180' }],
  },
  openGraph: {
    type: 'website',
    siteName: 'BrewCult',
    url: siteUrl,
    title: 'BrewCult — brewing intelligence for people who love coffee',
    description:
      'Log your brews, dial in your grinder and find coffee worth drinking. Beginners welcome.',
    images: [
      {
        url: '/og-1200x630.png',
        width: 1200,
        height: 630,
        alt: 'BrewCult',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'BrewCult',
    description: 'Brewing intelligence for people who love coffee.',
    images: ['/og-1200x630.png'],
  },
  appleWebApp: {
    capable: true,
    title: 'BrewCult',
    statusBarStyle: 'default',
  },
  /**
   * Search Console ownership. Set NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION to the
   * token from the "HTML tag" method and this emits the meta tag Google looks
   * for. Left unset it emits nothing at all — an empty verification tag is not
   * neutral, it is a tag that fails verification.
   *
   * Verification is what lets you SUBMIT the sitemap and see which pages were
   * indexed and why the rest were not. Without it you are waiting to be found.
   */
  verification: {
    google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || undefined,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Brand palette both ways — cream chrome in light, espresso chrome reversed.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: brand.cream },
    { media: '(prefers-color-scheme: dark)', color: brand.espresso },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Flags are evaluated server-side so the nav never flickers items in or out
  // (EF §2.5). A dead config endpoint yields the Phase-1 fallback.
  const config = await fetchClientConfig();

  // Cookie presence only — deliberately NOT a /me call. The nav renders on every
  // page, so an API round trip here would tax every navigation to decide whether
  // to draw one button. Reading the jar is free, and being wrong (an expired
  // token) costs a redirect to /login, which is where that person was headed.
  const signedIn = await hasSessionCookie();
  const navItems = visibleNavItems(config.features, signedIn);

  return (
    <html lang="en" className={spaceGrotesk.variable}>
      <body>
        <a className="bc-skip-link" href="#main">
          Skip to content
        </a>
        <SiteNav items={navItems} signedIn={signedIn} />
        <main id="main" className="bc-main bc-shell" tabIndex={-1}>
          {children}
        </main>
        <SiteFooter />
        {/*
          TODO(Wave 3 — offline brew logger): register the service worker here.
          Planned shape: a client-only <ServiceWorkerRegistrar /> that calls
          navigator.serviceWorker.register('/sw.js') after hydration, feeding the
          offline mutation queue in EF §2.2 (client-minted UUIDv7 + idempotent
          upserts). Caddy already serves /sw.js with `Cache-Control: no-store`
          (deployment_guide §5.3), so the SW updates immediately on deploy.
          Nothing is registered yet — shipping a SW before the offline queue
          exists would cache a shell we cannot invalidate.
        */}
      </body>
    </html>
  );
}
