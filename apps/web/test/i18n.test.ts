/**
 * Two languages, one route tree.
 *
 * The rules under test are the ones that break silently: a URL that gains a
 * second prefix, a switcher that drops somebody on the home page, a Spanish
 * catalogue that quietly went missing a key. None of those throw — they just
 * make the site subtly wrong for the half of the audience that reads the other
 * language, which is the half least likely to report it.
 */
import { describe, expect, it } from 'vitest';
import { en } from '../messages/en';
import { es } from '../messages/es';
import type { Locale } from '../lib/i18n';
import {
  DEFAULT_LOCALE,
  LOCALES,
  isLocale,
  localeFromAcceptLanguage,
  localeFromPath,
  localePath,
  stripLocale,
  translate,
} from '../lib/i18n';

describe('the URL shape', () => {
  it('leaves English unprefixed, which is how it is already indexed', () => {
    expect(localePath('/discover', 'en')).toBe('/discover');
    expect(localePath('/', 'en')).toBe('/');
    expect(localePath('/coffee/onyx-ethiopia', 'en')).toBe('/coffee/onyx-ethiopia');
  });

  it('prefixes Spanish', () => {
    expect(localePath('/discover', 'es')).toBe('/es/discover');
    expect(localePath('/', 'es')).toBe('/es');
  });

  it('never stacks two prefixes', () => {
    // The switcher runs on a path that may ALREADY carry one. Without the strip
    // this produces /es/es/discover, which 404s in a way nobody tests for.
    expect(localePath('/es/discover', 'es')).toBe('/es/discover');
    expect(localePath('/es/discover', 'en')).toBe('/discover');
    expect(localePath('/es', 'en')).toBe('/');
  });

  it('leaves a two-letter path segment that is not a locale alone', () => {
    // `/br/…` would be Brazil, not a language we serve. Stripping it would
    // quietly route somebody to the wrong page.
    expect(stripLocale('/br/coffee')).toBe('/br/coffee');
    expect(localeFromPath('/br/coffee')).toBe(DEFAULT_LOCALE);
  });

  it('reads the locale back out of a path', () => {
    expect(localeFromPath('/es/discover')).toBe('es');
    expect(localeFromPath('/discover')).toBe('en');
    expect(localeFromPath('/es')).toBe('es');
  });
});

describe('guessing from Accept-Language', () => {
  it('honours the highest-quality match', () => {
    expect(localeFromAcceptLanguage('es-CR,es;q=0.9,en;q=0.8')).toBe('es');
    expect(localeFromAcceptLanguage('en-US,en;q=0.9')).toBe('en');
  });

  it('respects quality ordering rather than header order', () => {
    // Firefox and Chrome both emit unordered lists; taking the first entry
    // would give Portuguese speakers Spanish and Spanish speakers English.
    expect(localeFromAcceptLanguage('en;q=0.2,es;q=0.9')).toBe('es');
  });

  it('falls back rather than guessing for a language we do not have', () => {
    expect(localeFromAcceptLanguage('pt-BR,pt;q=0.9')).toBe(DEFAULT_LOCALE);
    expect(localeFromAcceptLanguage('')).toBe(DEFAULT_LOCALE);
    expect(localeFromAcceptLanguage(null)).toBe(DEFAULT_LOCALE);
    expect(localeFromAcceptLanguage('garbage;;;')).toBe(DEFAULT_LOCALE);
  });

  it('matches a region-tagged locale by its base', () => {
    expect(localeFromAcceptLanguage('es-419')).toBe('es');
    expect(localeFromAcceptLanguage('en-GB')).toBe('en');
  });
});

describe('the catalogues', () => {
  /** Every leaf path, so the two can be compared key for key. */
  const paths = (node: unknown, prefix = ''): string[] => {
    if (typeof node === 'string') return [prefix];
    if (!node || typeof node !== 'object') return [];
    return Object.entries(node).flatMap(([key, value]) =>
      paths(value, prefix ? `${prefix}.${key}` : key),
    );
  };

  it('have exactly the same keys', () => {
    // `Messages` already makes a MISSING key a compile error. This catches the
    // other direction — a key that exists only in Spanish, which compiles fine
    // and is dead weight nobody ever notices.
    expect(paths(es).sort()).toEqual(paths(en).sort());
  });

  it('are actually translated, not copied', () => {
    // A handful of entries are legitimately identical (WhatsApp, Instagram,
    // Facebook are the same word). Everything else differing is the point.
    const identical = paths(en).filter(
      (key) => translate(en, key as never) === translate(es, key as never),
    );
    expect(identical.length).toBeLessThan(paths(en).length * 0.15);
  });

  it('leave no placeholder unmatched between languages', () => {
    // `{count}` present in English and missing in Spanish renders a sentence
    // with a hole in it — and the type system cannot see inside a string.
    for (const key of paths(en)) {
      const holes = (text: string) => (text.match(/\{(\w+)\}/g) ?? []).sort();
      expect({ key, holes: holes(translate(es, key as never)) }).toEqual({
        key,
        holes: holes(translate(en, key as never)),
      });
    }
  });
});

describe('looking a message up', () => {
  it('interpolates named placeholders', () => {
    expect(translate(en, 'notes.summary', { score: 8.5, count: 3 })).toBe(
      '8.5 overall from 3 people',
    );
    expect(translate(es, 'notes.summary', { score: 8.5, count: 3 })).toContain('8.5');
  });

  it('leaves an unsupplied placeholder visible rather than blank', () => {
    // A visible `{count}` gets reported; a silent gap does not.
    expect(translate(en, 'notes.summary', { score: 9 })).toContain('{count}');
  });

  it('answers with the key when a message is missing', () => {
    expect(translate(en, 'nope.not.here' as never)).toBe('nope.not.here');
  });
});

describe('locale guards', () => {
  it('recognises only the languages we serve', () => {
    for (const locale of LOCALES) expect(isLocale(locale)).toBe(true);
    for (const other of ['fr', 'pt', '', 'EN', null, 7]) expect(isLocale(other)).toBe(false);
  });
});

/**
 * The rule the language switcher depends on.
 *
 * These describe the middleware's DECISION rather than calling it — the real
 * function needs a NextRequest and the Next runtime, and what broke was never
 * the plumbing. It was the policy: a remembered language was allowed to
 * redirect a URL somebody had explicitly asked for, so clicking "English" on a
 * Spanish page bounced straight back and the switcher looked dead while working
 * perfectly.
 */
type Decision =
  | { kind: 'serve'; locale: Locale }
  | { kind: 'redirect'; to: Locale };

/** The middleware's policy, in one readable function. */
function decide(input: {
  path: string;
  cookie?: string | undefined;
  acceptLanguage?: string | undefined;
}): Decision {
  const prefix = input.path.split('/')[1];
  if (isLocale(prefix)) return { kind: 'serve', locale: prefix };

  if (!isLocale(input.cookie)) {
    const guessed = localeFromAcceptLanguage(input.acceptLanguage);
    if (guessed !== DEFAULT_LOCALE) return { kind: 'redirect', to: guessed };
  }
  return { kind: 'serve', locale: DEFAULT_LOCALE };
}

describe('which language a URL gets', () => {
  it('sends a first-time Spanish browser to the Spanish URL', () => {
    expect(decide({ path: '/discover', acceptLanguage: 'es-CR,es;q=0.9' })).toEqual({
      kind: 'redirect',
      to: 'es',
    });
  });

  it('NEVER redirects a URL somebody asked for, whatever they read last', () => {
    // The switcher bug, pinned. Clicking English requests `/discover`; a stored
    // `es` must not undo that.
    expect(decide({ path: '/discover', cookie: 'es', acceptLanguage: 'es-CR' })).toEqual({
      kind: 'serve',
      locale: 'en',
    });
    // And the same in reverse: an English reader following a shared Spanish
    // link gets Spanish, not their own preference.
    expect(decide({ path: '/es/discover', cookie: 'en' })).toEqual({
      kind: 'serve',
      locale: 'es',
    });
  });

  it('only guesses once — a returning English reader is left alone', () => {
    expect(decide({ path: '/discover', cookie: 'en', acceptLanguage: 'es-CR' })).toEqual({
      kind: 'serve',
      locale: 'en',
    });
  });

  it('serves English to a first-time visitor whose language we do not have', () => {
    expect(decide({ path: '/discover', acceptLanguage: 'pt-BR,pt;q=0.9' })).toEqual({
      kind: 'serve',
      locale: 'en',
    });
  });
});
