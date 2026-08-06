import { type Metadata } from 'next';
import { localePath } from '../../lib/i18n';
import { localeAlternates } from '../../lib/seo';
import { localeParam, translator } from '../../lib/locale-server';
import Link from 'next/link';
import { JsonLd, readCspNonce } from '../../components/catalog/json-ld';
import { brandSameAs } from '../../lib/seo';
import { organizationJsonLd, websiteJsonLd } from '../../lib/structured-data';
import { getSessionUser } from '../../lib/server-api';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = localeParam((await params).locale);
  return {
  title: 'BrewCult — brewing intelligence for people who love coffee',
  description:
    'Log a brew in ten seconds, learn what actually changed the cup, and find coffee worth drinking. Beginners welcome.',
    // Canonical for THIS language plus an hreflang for each, including
    // x-default — without which a search engine picks for a visitor whose
    // language is neither, and it does not pick well.
    alternates: localeAlternates('/', locale),
  };
}

const TAGLINE = 'Brewing intelligence for people who love coffee.';
const ABOUT =
  'BrewCult helps you log what you brew, understand what changed the cup, and find ' +
  'coffee and equipment worth your money — without gatekeeping.';

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = localeParam((await params).locale);
  const t = translator(locale);
  const [user, nonce] = await Promise.all([getSessionUser(), readCspNonce()]);

  // The brand entity lives HERE and only here. Every other page carries markup
  // about its own subject; this is the one that tells a search engine who
  // publishes all of it, which is what turns a name into a recognised brand
  // rather than four blue links.
  const brandDocuments = [
    organizationJsonLd({
      name: 'BrewCult',
      description: ABOUT,
      logoUrl: '/icons/icon-512.png',
      sameAs: brandSameAs(),
      email: 'admin@brewcult.coffee',
    }),
    websiteJsonLd('BrewCult', TAGLINE),
  ];

  return (
    <div className="bc-hero">
      <JsonLd documents={brandDocuments} nonce={nonce} />
      <h1>{t('home.headline')}</h1>
      <p className="bc-lede">{t('home.intro')}</p>
      <p>{t('home.welcome')}</p>

      <div className="bc-actions">
        {user ? (
          <>
            <Link className="bc-button" href={localePath('/discover', locale)}>
              {t('home.discoverCta')}
            </Link>
            <Link
              className="bc-button bc-button--secondary"
              href={localePath('/profile', locale)}
            >
              {t('home.profileCta')}
            </Link>
          </>
        ) : (
          <>
            <Link className="bc-button" href={localePath('/register', locale)}>
              {t('home.registerCta')}
            </Link>
            <Link
              className="bc-button bc-button--secondary"
              href={localePath('/discover', locale)}
            >
              {t('home.lookAroundCta')}
            </Link>
          </>
        )}
      </div>

      <ul className="bc-feature-grid">
        <li className="bc-card">
          <h2>{t('home.logTitle')}</h2>
          <p className="bc-card__meta">{t('home.logBody')}</p>
        </li>
        <li className="bc-card">
          <h2>{t('home.suggestionsTitle')}</h2>
          <p className="bc-card__meta">{t('home.suggestionsBody')}</p>
        </li>
        <li className="bc-card">
          <h2>{t('home.questionsTitle')}</h2>
          <p className="bc-card__meta">{t('home.questionsBody')}</p>
        </li>
      </ul>
    </div>
  );
}
