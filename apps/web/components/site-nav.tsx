'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useId, useState } from 'react';
import { DEFAULT_LOCALE, localePath, stripLocale, type Locale } from '../lib/i18n';
import { isActiveNavItem, type NavItem } from '../lib/nav';
import { BrandLockup } from './brand-lockup';
import { LanguageSwitcher } from './language-switcher';
import { SignOutButton } from './profile/sign-out-button';

export interface SiteNavProps {
  /** Already filtered by feature flags on the server (EF §2.5). */
  items: readonly NavItem[];
  /**
   * Whether a session cookie is present. Decided on the server from the cookie
   * jar alone — no API call — so the control never flickers in after hydration.
   *
   * Presence of the cookie is not proof the session is VALID, and that is fine:
   * the cost of showing Sign out to somebody whose token has expired is a
   * redirect to /login, which is where they were going anyway.
   */
  signedIn?: boolean;
  /** Which language is being read. Decided by the URL, never by a cookie. */
  locale?: Locale;
  /** Pre-translated labels; the nav itself stays a dumb renderer. */
  labels?: { language: string };
}

/**
 * Primary navigation (second_draft §27).
 *
 * The item list is decided server-side from client-config flags; this component
 * only renders and marks the current page. Below 720px it collapses behind a
 * disclosure button with the aria-expanded/aria-controls pair — no icon-only
 * mystery-meat button, the control says "Menu".
 */
export function SiteNav({
  items,
  signedIn = false,
  locale = DEFAULT_LOCALE,
  labels,
}: SiteNavProps) {
  const pathname = usePathname() ?? '/';
  const [open, setOpen] = useState(false);
  const navId = useId();

  return (
    <header className="bc-header">
      <div className="bc-shell bc-header__inner">
        <Link href={localePath('/', locale)} aria-label="BrewCult — home">
          <BrandLockup />
        </Link>

        <button
          type="button"
          className="bc-nav__toggle"
          aria-expanded={open}
          aria-controls={navId}
          onClick={() => setOpen((value) => !value)}
        >
          Menu
        </button>

        <nav
          id={navId}
          className="bc-nav"
          aria-label="Primary"
          data-open={open ? 'true' : 'false'}
        >
          <ul className="bc-nav__list">
            {items.map((item) => {
              // Compared with the prefix stripped: `/es/discover` is still the
              // discover page, and marking nothing current in Spanish would be
              // a quiet accessibility regression rather than a visible bug.
              const active = isActiveNavItem(item, stripLocale(pathname));
              return (
                <li key={item.key}>
                  <Link
                    className="bc-nav__link"
                    href={localePath(item.href, locale)}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => setOpen(false)}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
            {/* The nav has to answer "how do I get in?" for a signed-out
                visitor. Before this it showed Profile to everybody, which for
                them was a link that bounced straight to /login — a dead end
                dressed as a destination, with no way to sign in offered
                anywhere in the chrome.

                Sign out belongs here too, rather than only on the profile page:
                leaving should be reachable from wherever you are, which matters
                most on a shared or borrowed device (second_draft §30.4). */}
            {signedIn ? (
              <li className="bc-nav__signout">
                <SignOutButton />
              </li>
            ) : (
              <li className="bc-nav__auth">
                <Link
                  className="bc-nav__link"
                  href={localePath('/login', locale)}
                  onClick={() => setOpen(false)}
                >
                  Log in
                </Link>
                <Link
                  className="bc-button bc-button--secondary bc-nav__cta"
                  href={localePath('/register', locale)}
                  onClick={() => setOpen(false)}
                >
                  Sign up
                </Link>
              </li>
            )}
            <li className="bc-nav__lang">
              <LanguageSwitcher current={locale} label={labels?.language ?? 'Language'} />
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
