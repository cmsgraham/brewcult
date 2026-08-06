import { type Metadata } from 'next';
import { LocaleLink as Link } from '../../../../components/locale-link';
import { localeParam, translator } from '../../../../lib/locale-server';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const t = translator(localeParam((await params).locale));
  return {
    title: t('brew.offlineTitle'),
    description: t('brew.offlineDescription'),
    robots: { index: false, follow: false },
  };
}

/**
 * The service worker's navigation fallback (public/sw.js).
 *
 * Precached at install, so a cold start with no signal lands here instead of on
 * the browser's dinosaur — and the message is the true one: brews logged while
 * offline are safe on the device and sync themselves later.
 */
export default async function BrewOfflinePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = localeParam((await params).locale);
  const t = translator(locale);
  return (
    <div className="bc-stack">
      <h1>{t('brew.offlineTitle')}</h1>
      <p className="bc-lede">{t('brew.offlineBody')}</p>
      <p>
        <Link className="bc-button" href="/brew">
          {t('brew.backToLogger')}
        </Link>
      </p>
    </div>
  );
}
