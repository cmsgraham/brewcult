'use client';

import NextLink from 'next/link';
import type { ComponentProps } from 'react';
import { localePath } from '../lib/i18n';
import { useLocale } from './locale-provider';

type NextLinkProps = ComponentProps<typeof NextLink>;

/**
 * `<Link>`, but it keeps you in the language you are reading.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * The nav was translated first and got `localePath` by hand. Everything else —
 * every "browse the catalogue", every "back to your profile", the footer, the
 * link from a cupping score to the guide explaining it — kept a bare `href`.
 * So a Spanish reader stayed Spanish exactly until they clicked something, and
 * then silently became an English reader. That is worse than an untranslated
 * page, because it looks like the translation is broken rather than absent.
 *
 * Doing it per-link was never going to hold: the next link somebody adds is a
 * bare one, and nothing fails. This makes the correct thing the default one.
 *
 * ── WHAT IT LEAVES ALONE ────────────────────────────────────────────────────
 * Anything that is not a root-relative path: absolute URLs, `mailto:`, `tel:`,
 * bare fragments. A locale prefix on any of those is not a translation, it is a
 * broken link — and `next/link` is used for outbound URLs in a few places.
 *
 * It is a client component so it can read the locale from context, which means
 * server pages can use it without threading `locale` through every call. React
 * renders it inside the provider either way.
 */
export function LocaleLink({ href, ...rest }: NextLinkProps) {
  const { locale } = useLocale();
  const localized =
    typeof href === 'string' && href.startsWith('/') ? localePath(href, locale) : href;
  return <NextLink href={localized} {...rest} />;
}
