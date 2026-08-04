/**
 * Primary navigation (second_draft §27).
 *
 * The full eight-item primary nav is declared here in its final order so the
 * nav *grows by flipping a flag*, never by a rewrite. Phase 1 ships Home,
 * Discover and Profile; everything else is gated behind a server-evaluated
 * feature flag (EF §2.5) that currently defaults to `false`.
 *
 * §27 also notes eight top-level items is heavy and News may collapse into
 * Discover — that decision is a flag flip here, not a refactor.
 */
import type { FeatureFlags } from './client-config';

export type NavKey =
  | 'home'
  | 'brew'
  | 'ai'
  | 'discover'
  | 'news'
  | 'community'
  | 'marketplace'
  | 'profile';

export interface NavItem {
  readonly key: NavKey;
  readonly label: string;
  readonly href: string;
  /**
   * Feature flag that must be true for this item to render. Items without a
   * flag are always visible (Phase 1 surfaces).
   */
  readonly flag?: keyof FeatureFlags;
  /** Only shown to signed-in users. */
  readonly requiresAuth?: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'home', label: 'Home', href: '/' },
  { key: 'brew', label: 'Brew', href: '/brew', flag: 'navBrew' },
  { key: 'ai', label: 'AI', href: '/ai', flag: 'navAi' },
  { key: 'discover', label: 'Discover', href: '/discover' },
  { key: 'news', label: 'News', href: '/news', flag: 'navNews' },
  { key: 'community', label: 'Community', href: '/community', flag: 'navCommunity' },
  {
    key: 'marketplace',
    label: 'Marketplace',
    href: '/marketplace',
    flag: 'navMarketplace',
  },
  { key: 'profile', label: 'Profile', href: '/profile' },
] as const;

/** Items the current visitor should see, in §27 order. */
export function visibleNavItems(flags: FeatureFlags): NavItem[] {
  return NAV_ITEMS.filter((item) => item.flag === undefined || flags[item.flag] === true);
}

/**
 * `aria-current="page"` matching. Exact for '/', prefix for everything else so
 * /discover/ethiopia-yirgacheffe still highlights Discover.
 */
export function isActiveNavItem(item: NavItem, pathname: string): boolean {
  if (item.href === '/') return pathname === '/';
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
