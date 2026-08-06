/**
 * Two languages, one tree.
 *
 * ── THE URL SHAPE, AND WHY IT IS THIS ONE ───────────────────────────────────
 * English lives at the root (`/discover`) and Spanish under a prefix
 * (`/es/discover`). Not `/en/discover`: every URL already indexed by Google
 * points at the unprefixed form, and moving them would trade real rankings for
 * symmetry. The prefix-the-non-default shape is what Google documents, costs
 * nothing, and can be flipped later with redirects if Spanish becomes the
 * primary audience — which, for a Costa Rican coffee site, it may well.
 *
 * ── WHY A HAND-ROLLED CATALOGUE RATHER THAN next-intl ───────────────────────
 * Two locales, no plural-heavy copy, and an existing middleware that already
 * owns the request. A routing library would want to own that middleware and
 * bring its own opinions about segments; what it buys us — ICU plurals, lazy
 * message chunks — is not what we need at this size. `Intl` already does the
 * hard parts (numbers, currency, dates) and we already use it directly.
 *
 * The one thing this file DOES buy, which a bag of loose strings would not:
 * `Messages` is derived from the English catalogue, so a key missing from
 * Spanish is a TYPE ERROR rather than a blank space somebody notices in
 * production.
 *
 * ── WHAT IS NEVER TRANSLATED ────────────────────────────────────────────────
 * Catalogue DATA. A roaster is called what it is called, a coffee is named
 * what the bag says, and tasting notes are the roaster's own words about their
 * own coffee. Translating any of those would be putting words in a business's
 * mouth. Only OUR copy is in here.
 */
import type { en } from '../messages/en';

export const LOCALES = ['en', 'es'] as const;
export type Locale = (typeof LOCALES)[number];

/** Unprefixed. See the note above before changing this. */
export const DEFAULT_LOCALE: Locale = 'en';

/** Remembers a deliberate choice, so the switcher survives a navigation. */
export const LOCALE_COOKIE = 'bc_locale';

/** A year: a language preference is not a session. */
export const LOCALE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

export const LOCALE_LABEL: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
};

/** The `lang` attribute and the `hreflang` value. */
export const LOCALE_TAG: Record<Locale, string> = {
  en: 'en',
  es: 'es',
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * The shape every catalogue must have, derived from English.
 *
 * English is the source of truth by construction: adding a key there and
 * forgetting Spanish fails `tsc`, which is the only way a two-language app
 * stays two languages six months later.
 */
export type Messages = Widen<typeof en>;

/**
 * The KEYS of the English catalogue, with the values widened back to `string`.
 *
 * `en` is `as const`, which is what makes the dotted key paths below exact —
 * but it also makes every value its own literal type, and a Spanish catalogue
 * typed against those literals could only contain the English words. Widening
 * keeps the half that matters: every key is still required, so a message
 * missing from `es.ts` is a compile error.
 */
type Widen<T> = T extends string ? string : { [K in keyof T]: Widen<T[K]> };

/** Dotted paths into the catalogue: 'nav.discover', 'coffee.notes.heading'. */
export type MessageKey = Paths<Messages>;

type Paths<T> = T extends string
  ? never
  : {
      [K in keyof T & string]: T[K] extends string ? K : `${K}.${Paths<T[K]>}`;
    }[keyof T & string];

/**
 * Look a message up, and interpolate `{name}` placeholders.
 *
 * Returns the KEY when a message is missing, rather than an empty string: a
 * page reading "coffee.notes.heading" is an obvious bug, and a page with a
 * silent gap is one nobody reports.
 */
export function translate(
  messages: Messages,
  key: MessageKey,
  values?: Record<string, string | number>,
): string {
  const found = key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], messages);

  if (typeof found !== 'string') return key;
  if (!values) return found;

  return found.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}

/** A bound `t` for one locale's catalogue. */
export type Translator = (key: MessageKey, values?: Record<string, string | number>) => string;

/**
 * Where a path lives in the other language.
 *
 * Path SEGMENTS are not translated — `/es/discover`, not `/es/descubrir`.
 * Translated slugs would mean a second routing table and a second sitemap for
 * the same pages, and would break the moment a coffee slug (which comes from a
 * roaster's own words) had to exist in two forms.
 */
export function localePath(path: string, locale: Locale): string {
  const bare = stripLocale(path);
  if (locale === DEFAULT_LOCALE) return bare;
  return `/${locale}${bare === '/' ? '' : bare}`;
}

/** The path without any locale prefix. Always starts with `/`. */
export function stripLocale(path: string): string {
  const match = /^\/([a-z]{2})(?=\/|$)/.exec(path);
  if (match && isLocale(match[1])) {
    const rest = path.slice(match[0].length);
    return rest === '' ? '/' : rest;
  }
  return path === '' ? '/' : path;
}

/** The locale a path is asking for, or the default. */
export function localeFromPath(path: string): Locale {
  const match = /^\/([a-z]{2})(?=\/|$)/.exec(path);
  return match && isLocale(match[1]) ? match[1] : DEFAULT_LOCALE;
}

/**
 * The best locale for an `Accept-Language` header.
 *
 * Deliberately crude: quality values are parsed, everything else is ignored,
 * and anything unrecognised falls back to the default. A wrong guess costs one
 * click on the switcher; over-thinking this costs a maintainer an hour every
 * time they read it.
 */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;

  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      return {
        tag: (tag ?? '').trim().toLowerCase(),
        q: q ? Number(q.split('=')[1]) || 0 : 1,
      };
    })
    .sort((a, b) => b.q - a.q);

  for (const { tag } of ranked) {
    const base = tag.split('-')[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}
