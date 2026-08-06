import { type Metadata } from 'next';
import { LocaleLink as Link } from '../../../components/locale-link';
import { localeAlternates } from '../../../lib/seo';
import { localeParam, translator } from '../../../lib/locale-server';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const locale = localeParam((await params).locale);
  const t = translator(locale);
  return {
    title: t('privacyPage.title'),
    description: t('privacyPage.metaDescription'),
    alternates: localeAlternates('/privacy', locale),
  };
}

/**
 * Plain-language summary (EF §4.5). The reviewed legal text lands before public
 * launch; this page exists now because the signup flow links to it, and an
 * unlinked promise is not a promise.
 */
export default async function PrivacyPage({ params }: PageProps) {
  const t = translator(localeParam((await params).locale));

  return (
    <div className="bc-stack">
      <h1>{t('privacyPage.title')}</h1>
      <p className="bc-lede">{t('privacyPage.lede')}</p>

      <h2>{t('privacyPage.whatHeading')}</h2>
      <p>{t('privacyPage.whatBody')}</p>

      <h2>{t('privacyPage.whyHeading')}</h2>
      <p>{t('privacyPage.whyBody')}</p>

      <h2>{t('privacyPage.howLongHeading')}</h2>
      <p>{t('privacyPage.howLongBody')}</p>

      <h2>{t('privacyPage.controlsHeading')}</h2>
      <p>
        {t('privacyPage.controlsBefore')}
        <Link href="/profile">{t('privacyPage.controlsLink')}</Link>
        {t('privacyPage.controlsAfter')}
      </p>

      <h2>{t('privacyPage.whoHeading')}</h2>
      <p>{t('privacyPage.whoBody')}</p>

      <p className="bc-muted">{t('privacyPage.note')}</p>
    </div>
  );
}
