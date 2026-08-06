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
    title: t('termsPage.title'),
    description: t('termsPage.metaDescription'),
    alternates: localeAlternates('/terms', locale),
  };
}

export default async function TermsPage({ params }: PageProps) {
  const t = translator(localeParam((await params).locale));

  return (
    <div className="bc-stack">
      <h1>{t('termsPage.title')}</h1>
      <p className="bc-lede">{t('termsPage.lede')}</p>

      <h2>{t('termsPage.whoHeading')}</h2>
      <p>{t('termsPage.whoBody')}</p>

      <h2>{t('termsPage.behaviourHeading')}</h2>
      <p>{t('termsPage.behaviourBody')}</p>

      <h2>{t('termsPage.contentHeading')}</h2>
      <p>{t('termsPage.contentBody')}</p>

      <h2>{t('termsPage.ourSideHeading')}</h2>
      <p>
        {t('termsPage.ourSideBefore')}
        <Link href="/privacy">{t('termsPage.ourSideLink')}</Link>
        {t('termsPage.ourSideAfter')}
      </p>

      <h2>{t('termsPage.endingHeading')}</h2>
      <p>
        {t('termsPage.endingBefore')}
        <Link href="/profile">{t('termsPage.endingLink')}</Link>
        {t('termsPage.endingAfter')}
      </p>
    </div>
  );
}
