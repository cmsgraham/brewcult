import { type Metadata } from 'next';
import { BrewHistory } from '../../../../components/logger/brew-history';
import { localeParam, translator } from '../../../../lib/locale-server';
import '../logger.css';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const t = translator(localeParam((await params).locale));
  return {
    title: t('history.title'),
    description: t('history.description'),
    // Somebody's own brew log. Private by definition, and never a landing page.
    robots: { index: false, follow: false },
  };
}

/**
 * /brew/history — the log the logger has been filling in.
 *
 * Nested under `/brew` rather than living at `/brews`: the two would be one
 * character apart in every URL, and this is the same feature seen from the
 * other end. It also leaves the top level free for the public per-user pages
 * that a shared wall would need.
 *
 * Never cached: every row is private to one account.
 */
export const dynamic = 'force-dynamic';

export default async function BrewHistoryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const t = translator(localeParam((await params).locale));
  return (
    <div className="bc-stack">
      <h1>{t('history.title')}</h1>
      <p className="bc-lede">{t('history.lede')}</p>
      <BrewHistory />
    </div>
  );
}
