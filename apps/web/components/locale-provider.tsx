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
 * Falls back to English rather than throwing when no provider is above.
 *
 * A missing provider is a wiring mistake, and the honest failure for one is an
 * English label in a Spanish page — visible, reportable, harmless. Throwing
 * would take down a working page over a translation.
 */
export function useLocale(): LocaleContextValue {
  const found = useContext(LocaleContext);
  if (found) return found;
  return {
    locale: DEFAULT_LOCALE,
    t: (key, values) => translate(CATALOGUES[DEFAULT_LOCALE], key, values),
  };
}

/** The common case: just the translator. */
export function useTranslate(): Translator {
  return useLocale().t;
}
