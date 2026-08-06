/**
 * Reading the locale on the server, without breaking the cache.
 *
 * ── WHY THE ROUTE PARAM AND NOT A COOKIE ────────────────────────────────────
 * Because a page that reads `cookies()` becomes per-request, and the catalogue
 * pages are `revalidate`-cached SEO surfaces shared by everybody. That trap has
 * already been walked into once here (the coffee page briefly read a session
 * cookie to pick one sentence). A route segment is free: `/es/discover` and
 * `/discover` are two cache entries, which is exactly what they should be.
 *
 * The cookie exists only in the MIDDLEWARE, where it decides which URL to send
 * a first-time visitor to. Once they are on a URL, the URL is the truth.
 */
import { en } from '../messages/en';
import { es } from '../messages/es';
import {
  DEFAULT_LOCALE,
  isLocale,
  translate,
  type Locale,
  type MessageKey,
  type Messages,
  type Translator,
} from './i18n';

const CATALOGUES: Record<Locale, Messages> = { en, es };

/** Both catalogues are small and both ship anyway; no reason to lazy-load. */
export function messagesFor(locale: Locale): Messages {
  return CATALOGUES[locale];
}

/**
 * What a page gets from `params.locale`.
 *
 * Anything unrecognised falls back rather than 404s: a stray `/fr/discover`
 * should show the English page, not an error. The canonical tag on the page
 * still points at the real URL, so nothing is indexed twice.
 */
export function localeParam(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** A bound translator for a page or a server component. */
export function translator(locale: Locale): Translator {
  const messages = messagesFor(locale);
  return (key: MessageKey, values?: Record<string, string | number>) =>
    translate(messages, key, values);
}
