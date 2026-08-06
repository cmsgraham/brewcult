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
import type { MessageKey } from './i18n';

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
  /**
   * English, and a fallback rather than the thing rendered.
   *
   * The nav is drawn from `labelKey` below; this stays so a caller that has no
   * translator (a test, a future non-localised surface) still renders words
   * rather than keys.
   */
  readonly label: string;
  /** Where the rendered label actually comes from. */
  readonly labelKey: MessageKey;
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
  { key: 'home', label: 'Home', labelKey: 'nav.home', href: '/' },
  { key: 'brew', label: 'Brew', labelKey: 'nav.brew', href: '/brew', flag: 'navBrew' },
  { key: 'ai', label: 'AI', labelKey: 'nav.ai', href: '/ai', flag: 'navAi' },
  { key: 'discover', label: 'Discover', labelKey: 'nav.discoverShort', href: '/discover' },
  { key: 'news', label: 'News', labelKey: 'nav.news', href: '/news', flag: 'navNews' },
  { key: 'community', label: 'Community', labelKey: 'nav.community', href: '/community', flag: 'navCommunity' },
  {
    key: 'marketplace',
    label: 'Marketplace',
    labelKey: 'nav.marketplace',
    href: '/marketplace',
    flag: 'navMarketplace',
  },
  // The only destination that genuinely needs a session: /profile redirects a
  // signed-out visitor straight to /login. Brew, AI and Discover all serve
  // anonymously, so they stay visible — hiding a page that works would cost a
  // visitor the reason to sign up in the first place.
  { key: 'profile', label: 'Profile', labelKey: 'common.profile', href: '/profile', requiresAuth: true },
] as const;

/**
 * Items the current visitor should see, in §27 order.
 *
 * `requiresAuth` had been declared on NavItem since the nav was written and
 * never once set or read — so "Profile" was shown to everybody, and a
 * signed-out visitor clicking it got bounced to /login. That is a dead end
 * dressed as a destination: the nav offered no way to sign IN, only a link
 * that punished you for trying.
 */
export function visibleNavItems(flags: FeatureFlags, signedIn = false): NavItem[] {
  return NAV_ITEMS.filter((item) => {
    if (item.flag !== undefined && flags[item.flag] !== true) return false;
    if (item.requiresAuth === true && !signedIn) return false;
    return true;
  });
}

/**
 * `aria-current="page"` matching. Exact for '/', prefix for everything else so
 * /discover/ethiopia-yirgacheffe still highlights Discover.
 */
export function isActiveNavItem(item: NavItem, pathname: string): boolean {
  if (item.href === '/') return pathname === '/';
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
