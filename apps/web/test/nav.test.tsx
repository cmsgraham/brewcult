import { render, screen, within } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SiteNav } from '../components/site-nav';
import { DEFAULT_FEATURE_FLAGS, type FeatureFlags } from '../lib/client-config';
import { isActiveNavItem, NAV_ITEMS, visibleNavItems } from '../lib/nav';

// next/link and next/navigation need an app-router context that does not exist
// in a unit test; stubbing them keeps the test about the nav, not about Next.
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

let pathname = '/';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

function flags(overrides: Partial<FeatureFlags> = {}): FeatureFlags {
  return { ...DEFAULT_FEATURE_FLAGS, ...overrides };
}

describe('nav feature-flag gating', () => {
  it('declares the full second_draft §27 nav in order', () => {
    expect(NAV_ITEMS.map((item) => item.label)).toEqual([
      'Home',
      'Brew',
      'AI',
      'Discover',
      'News',
      'Community',
      'Marketplace',
      'Profile',
    ]);
  });

  it('shows only the Phase-1 surfaces by default', () => {
    // Brew joined the default set when the logger shipped (Wave 3); the rest of
    // the §27 nav stays behind flags until its phase lands.
    // Signed IN, because Profile is auth-gated — see the signed-out case below.
    expect(visibleNavItems(flags(), true).map((item) => item.key)).toEqual([
      'home',
      'brew',
      'ai',
      'discover',
      'profile',
    ]);
  });

  it('HIDES Profile from a signed-out visitor', () => {
    // It redirects to /login for them, so offering it is a dead end dressed as
    // a destination. Everything else stays: Brew, AI and Discover all serve
    // anonymously, and hiding a page that works would remove the very reason
    // somebody would sign up.
    expect(visibleNavItems(flags(), false).map((item) => item.key)).toEqual([
      'home',
      'brew',
      'ai',
      'discover',
    ]);
  });

  it('defaults to the signed-out view rather than leaking an auth-only link', () => {
    // A caller that forgets the argument must fail CLOSED.
    expect(visibleNavItems(flags()).map((item) => item.key)).not.toContain('profile');
  });

  it('grows by flipping a flag, keeping §27 order', () => {
    const items = visibleNavItems(flags({ navNews: true, navBrew: true }), true);
    expect(items.map((item) => item.key)).toEqual([
      'home',
      'brew',
      'ai',
      'discover',
      'news',
      'profile',
    ]);
  });

  it('turns everything gated on at once', () => {
    const all = visibleNavItems(
      flags({
        navBrew: true,
        navAi: true,
        navNews: true,
        navCommunity: true,
        navMarketplace: true,
      }),
      true,
    );
    expect(all).toHaveLength(NAV_ITEMS.length);
  });
});

describe('SiteNav', () => {
  it('renders only the items it is given', () => {
    pathname = '/';
    render(<SiteNav items={visibleNavItems(flags(), true)} signedIn />);

    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getByRole('link', { name: 'Home' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Discover' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Profile' })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Marketplace' })).toBeNull();
    expect(within(nav).queryByRole('link', { name: 'News' })).toBeNull();
  });

  it('marks the current page for assistive tech', () => {
    pathname = '/discover';
    render(<SiteNav items={visibleNavItems(flags())} />);

    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getByRole('link', { name: 'Discover' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Home' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('exposes the mobile disclosure with a real name and aria-expanded', () => {
    pathname = '/';
    render(<SiteNav items={visibleNavItems(flags())} />);

    const toggle = screen.getByRole('button', { name: 'Menu' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls');
  });

  it('always carries the brand lockup as the home link', () => {
    pathname = '/';
    render(<SiteNav items={visibleNavItems(flags())} />);

    const home = screen.getByRole('link', { name: 'BrewCult — home' });
    expect(home).toHaveAttribute('href', '/');
  });
});

describe('isActiveNavItem', () => {
  const discover = NAV_ITEMS.find((item) => item.key === 'discover')!;
  const home = NAV_ITEMS.find((item) => item.key === 'home')!;

  it('matches nested catalog routes but keeps Home exact', () => {
    expect(isActiveNavItem(discover, '/discover/ethiopia-yirgacheffe')).toBe(true);
    expect(isActiveNavItem(home, '/discover')).toBe(false);
    expect(isActiveNavItem(home, '/')).toBe(true);
  });
});

describe('SiteNav — the signed-out visitor can actually get in', () => {
  it('offers Log in and Sign up instead of Profile', () => {
    pathname = '/';
    render(<SiteNav items={visibleNavItems(flags(), false)} signedIn={false} />);

    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
    expect(within(nav).getByRole('link', { name: 'Sign up' })).toHaveAttribute(
      'href',
      '/register',
    );
    // The dead end this replaced.
    expect(within(nav).queryByRole('link', { name: 'Profile' })).toBeNull();
    expect(within(nav).queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('offers Sign out and no auth prompts once signed in', () => {
    pathname = '/';
    render(<SiteNav items={visibleNavItems(flags(), true)} signedIn />);

    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Log in' })).toBeNull();
    expect(within(nav).queryByRole('link', { name: 'Sign up' })).toBeNull();
  });
});
