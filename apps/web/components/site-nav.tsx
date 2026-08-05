'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useId, useState } from 'react';
import { isActiveNavItem, type NavItem } from '../lib/nav';
import { BrandLockup } from './brand-lockup';
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
}

/**
 * Primary navigation (second_draft §27).
 *
 * The item list is decided server-side from client-config flags; this component
 * only renders and marks the current page. Below 720px it collapses behind a
 * disclosure button with the aria-expanded/aria-controls pair — no icon-only
 * mystery-meat button, the control says "Menu".
 */
export function SiteNav({ items, signedIn = false }: SiteNavProps) {
  const pathname = usePathname() ?? '/';
  const [open, setOpen] = useState(false);
  const navId = useId();

  return (
    <header className="bc-header">
      <div className="bc-shell bc-header__inner">
        <Link href="/" aria-label="BrewCult — home">
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
              const active = isActiveNavItem(item, pathname);
              return (
                <li key={item.key}>
                  <Link
                    className="bc-nav__link"
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => setOpen(false)}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
            {/* Sign out belongs in the nav, not only on the profile page:
                leaving should be reachable from wherever you are, which matters
                most on a shared or borrowed device (second_draft §30.4). */}
            {signedIn ? (
              <li className="bc-nav__signout">
                <SignOutButton />
              </li>
            ) : null}
          </ul>
        </nav>
      </div>
    </header>
  );
}
