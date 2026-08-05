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
    expect(visibleNavItems(flags()).map((item) => item.key)).toEqual([
      'home',
      'brew',
      'discover',
      'profile',
    ]);
  });

  it('grows by flipping a flag, keeping §27 order', () => {
    const items = visibleNavItems(flags({ navNews: true, navBrew: true }));
    expect(items.map((item) => item.key)).toEqual([
      'home',
      'brew',
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
    );
    expect(all).toHaveLength(NAV_ITEMS.length);
  });
});

describe('SiteNav', () => {
  it('renders only the items it is given', () => {
    pathname = '/';
    render(<SiteNav items={visibleNavItems(flags())} />);

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
