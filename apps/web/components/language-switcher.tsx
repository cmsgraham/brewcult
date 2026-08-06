'use client';

import { usePathname } from 'next/navigation';
import { LOCALES, LOCALE_LABEL, localePath, type Locale } from '../lib/i18n';

/**
 * The other language, one link away.
 *
 * ── LINKS, NOT A SELECT ─────────────────────────────────────────────────────
 * Two languages means two anchors, and an anchor is something a browser can
 * open in a new tab, a crawler can follow, and a person can middle-click. A
 * `<select onChange={navigate}>` would be none of those, and would need
 * JavaScript to do what an href does for free.
 *
 * ── IT LINKS TO THE SAME PAGE, NOT TO HOME ──────────────────────────────────
 * Somebody reading a coffee page who switches language wants THAT coffee in
 * Spanish. Bouncing them to the home page is the single most common way this
 * control is got wrong, and it is why `localePath` rebuilds the current path
 * rather than returning a bare prefix.
 *
 * `usePathname()` already reports the visitor-facing path (`/discover`), not
 * the rewritten internal one (`/en/discover`) — but `localePath` strips any
 * prefix anyway, so a future change to the rewrite cannot silently produce
 * `/es/en/discover`.
 */
export function LanguageSwitcher({ current, label }: { current: Locale; label: string }) {
  const pathname = usePathname() ?? '/';

  return (
    <nav className="bc-lang" aria-label={label}>
      {LOCALES.map((locale) => {
        const isCurrent = locale === current;
        return (
          <a
            key={locale}
            href={localePath(pathname, locale)}
            hrefLang={locale}
            lang={locale}
            className="bc-lang__option"
            // The current language is marked rather than removed: a switcher
            // that hides where you are makes you guess whether it worked.
            aria-current={isCurrent ? 'true' : undefined}
          >
            {LOCALE_LABEL[locale]}
          </a>
        );
      })}
    </nav>
  );
}
