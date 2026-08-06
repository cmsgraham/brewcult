'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { en } from '../messages/en';
import { es } from '../messages/es';
import {
  DEFAULT_LOCALE,
  translate,
  type Locale,
  type MessageKey,
  type Messages,
  type Translator,
} from '../lib/i18n';

/**
 * The catalogue, for client islands.
 *
 * ── WHY A CONTEXT AND NOT PROPS ─────────────────────────────────────────────
 * The alternative is threading a `t` — or worse, forty pre-translated strings —
 * through every island on the page. That works until somebody adds a string to
 * a component three levels down and has to plumb it up through two files that
 * do not otherwise care. Context is what this is for.
 *
 * ── WHY BOTH CATALOGUES ARE IN THE BUNDLE ───────────────────────────────────
 * Together they are a few kilobytes of text, gzipped smaller, and splitting
 * them would mean a second request before an island can render its own labels
 * — a visible flash of English on a Spanish page, to save less than one photo.
 * Revisit at ten languages, not at two.
 *
 * The locale itself still comes from the URL via the server layout. Nothing
 * here reads a cookie: a page's language is a property of its address, so two
 * people opening the same link see the same page.
 */
const CATALOGUES: Record<Locale, Messages> = { en, es };

interface LocaleContextValue {
  locale: Locale;
  t: Translator;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo<LocaleContextValue>(() => {
    const messages = CATALOGUES[locale] ?? CATALOGUES[DEFAULT_LOCALE];
    return {
      locale,
      t: (key: MessageKey, values?: Record<string, string | number>) =>
        translate(messages, key, values),
    };
  }, [locale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/**
 * The value `useLocale` hands back when there is no provider above it.
 *
 * ── WHY THIS IS A MODULE CONSTANT AND NOT AN OBJECT LITERAL ─────────────────
 * It used to be built inside the hook, which meant a fresh `t` on every single
 * render. `t` is a legitimate dependency — a status message set in an effect
 * has to be re-translated when the language changes — so components correctly
 * list it in their dependency arrays. With an unstable identity that array
 * never matches, and `[t]` becomes "every render": the effect runs, sets state,
 * causes a render, and runs again. An infinite loop, dressed as a dependency.
 *
 * It cost an afternoon. `test/logger-paths.test.tsx` renders the logger with no
 * provider, so `coffee-picker` span its debounced search forever; the file
 * climbed to an 8 GB heap and took the whole suite down with it, which read as
 * "vitest leaks memory" for as long as nobody looked closely.
 *
 * The provider's own value is already memoised on `locale`, so this is the only
 * path that was ever unstable — and it is exactly the path that is hardest to
 * notice, because a missing provider otherwise fails so gracefully.
 */
const ENGLISH_FALLBACK: LocaleContextValue = {
  locale: DEFAULT_LOCALE,
  t: (key: MessageKey, values?: Record<string, string | number>) =>
    translate(CATALOGUES[DEFAULT_LOCALE], key, values),
};

/**
 * Falls back to English rather than throwing when no provider is above.
 *
 * A missing provider is a wiring mistake, and the honest failure for one is an
 * English label in a Spanish page — visible, reportable, harmless. Throwing
 * would take down a working page over a translation.
 */
export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext) ?? ENGLISH_FALLBACK;
}

/** The common case: just the translator. */
export function useTranslate(): Translator {
  return useLocale().t;
}
