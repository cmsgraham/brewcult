import { type Metadata } from 'next';
import { LocaleLink as Link } from '../../../components/locale-link';
import { BrewLogger } from '../../../components/logger/brew-logger';
import { localeParam, translator } from '../../../lib/locale-server';
import './logger.css';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const t = translator(localeParam((await params).locale));
  return {
    title: t('brew.title'),
    description: t('brew.description'),
    robots: { index: false, follow: false },
  };
}

/**
 * The brew logger (BREW-02/03/04).
 *
 * Rendered on the client and hydrated from IndexedDB rather than server-fetched:
 * the screen has to be interactive before any network response (§5), and the
 * device — not the server — is the source of truth for a brew until it syncs.
 * That is also why this route is never cached or prerendered with data.
 */
export const dynamic = 'force-dynamic';

export default async function BrewPage({ params }: { params: Promise<{ locale: string }> }) {
  const t = translator(localeParam((await params).locale));
  return (
    <div className="bc-stack">
      <h1 className="bc-visually-hidden">{t('brew.title')}</h1>
      <BrewLogger />
      {/* The way back to what the logging was for. Below the card rather than
          above it: the point of this screen is to log, not to browse. */}
      <p className="bc-logger__footnote">
        <Link href="/brew/history">{t('history.title')}</Link>
      </p>
      <p className="bc-muted bc-logger__footnote">{t('brew.footnote')}</p>
    </div>
  );
}
