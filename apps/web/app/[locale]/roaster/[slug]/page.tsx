import { type Metadata } from 'next';
import { localeParam, translator } from '../../../../lib/locale-server';
import { LocaleLink as Link } from '../../../../components/locale-link';
import { notFound } from 'next/navigation';
import { Breadcrumbs } from '../../../../components/catalog/breadcrumbs';
import { loadRoaster } from '../../../../components/catalog/catalog-api';
import styles from '../../../../components/catalog/catalog.module.css';
import { CoffeeCard } from '../../../../components/catalog/entity-cards';
import { JsonLd, readCspNonce } from '../../../../components/catalog/json-ld';
import { SpecList } from '../../../../components/catalog/spec-list';
import { notFoundMetadata, roasterMetadata } from '../../../../lib/seo';
import { breadcrumbJsonLd, roasterOrganizationJsonLd } from '../../../../lib/structured-data';

/**
 * Roaster profile (CAT-09).
 *
 * The roaster is the hub of the coffee half of the entity graph (§5) — one
 * fetch returns the profile *and* its coffees, so the whole page is a single
 * cached round-trip. The origins they buy from are derived from those coffees
 * rather than fetched separately: same data, no extra request.
 */
export const revalidate = 300;

interface PageProps {
  params: Promise<{ slug: string; locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, locale: rawLocale } = await params;
  const t = translator(localeParam(rawLocale));
  const result = await loadRoaster(slug);
  if (result.status !== 'ok') return notFoundMetadata(t('catalog.roasterDetail.eyebrow'));

  const roaster = result.data;
  return roasterMetadata({
    slug: roaster.slug,
    name: roaster.name,
    location: roaster.location ?? null,
    coffeeCount: roaster.coffee_count ?? roaster.coffees?.length ?? 0,
  });
}

export default async function RoasterDetailPage({ params }: PageProps) {
  const { slug, locale: rawLocale } = await params;
  const locale = localeParam(rawLocale);
  const t = translator(locale);
  const [result, nonce] = await Promise.all([loadRoaster(slug), readCspNonce()]);

  if (result.status === 'missing') notFound();
  if (result.status === 'error') {
    return (
      <div className="bc-stack">
        <h1>{t('catalog.roasterDetail.loadErrorTitle')}</h1>
        <p className="bc-lede">
          {t('catalog.roasterDetail.loadErrorBody')}
          <Link href="/roaster">{t('catalog.roasterDetail.loadErrorLink')}</Link>.
        </p>
      </div>
    );
  }

  const roaster = result.data;
  const coffees = roaster.coffees ?? [];
  const active = coffees.filter((coffee) => coffee.status !== 'discontinued');
  const retired = coffees.filter((coffee) => coffee.status === 'discontinued');

  const origins = [
    ...new Set(
      coffees
        .map((coffee) => coffee.origin?.country)
        .filter((country): country is string => Boolean(country)),
    ),
  ].sort();

  const breadcrumbs = [
    { name: t('catalog.crumbs.home'), path: '/' },
    { name: t('catalog.crumbs.roasters'), path: '/roaster' },
    { name: roaster.name, path: `/roaster/${roaster.slug}` },
  ];

  // Only used when the roaster has written no description of their own. Their
  // words are never replaced by ours.
  const where = roaster.location
    ? t('catalog.roasterDetail.ledeWhere', { location: roaster.location })
    : '';
  const fallbackLede =
    coffees.length === 1
      ? t('catalog.roasterDetail.ledeOne', { name: roaster.name, where })
      : t('catalog.roasterDetail.ledeOther', {
          name: roaster.name,
          count: coffees.length,
          where,
        });

  return (
    <div className="bc-stack">
      <JsonLd
        nonce={nonce}
        documents={[
          roasterOrganizationJsonLd({
            slug: roaster.slug,
            name: roaster.name,
            description: roaster.description ?? null,
            location: roaster.location ?? null,
            websiteUrl: roaster.website_url ?? null,
          }),
          breadcrumbJsonLd(breadcrumbs),
        ]}
      />

      <Breadcrumbs entries={breadcrumbs} locale={locale} />

      <header className={styles.header}>
        <p className={styles.eyebrow}>{t('catalog.roasterDetail.eyebrow')}</p>
        <h1>{roaster.name}</h1>
        <p className="bc-lede">{roaster.description ?? fallbackLede}</p>
      </header>

      <section aria-labelledby="profile">
        <h2 id="profile">{t('catalog.roasterDetail.profile')}</h2>
        <SpecList
          rows={[
            { label: t('catalog.roasterDetail.location'), value: roaster.location ?? null },
            {
              label: t('catalog.roasterDetail.coffeesListed'),
              value: coffees.length > 0 ? String(coffees.length) : null,
            },
            {
              label: t('catalog.roasterDetail.originsBought'),
              value: origins.length > 0 ? origins.join(', ') : null,
            },
            {
              label: t('catalog.roasterDetail.verified'),
              value: roaster.verified
                ? t('catalog.roasterDetail.verifiedYes')
                : t('catalog.roasterDetail.verifiedNo'),
            },
            {
              label: t('catalog.roasterDetail.website'),
              value: roaster.website_url ?? null,
              ...(roaster.website_url ? { href: roaster.website_url } : {}),
            },
          ]}
        />
      </section>

      <section className={styles.section} aria-labelledby="coffees">
        <h2 id="coffees">{t('catalog.roasterDetail.theirCoffees')}</h2>
        {active.length === 0 && retired.length === 0 ? (
          <p className="bc-muted">
            {t('catalog.roasterDetail.noCoffees', { name: roaster.name })}
          </p>
        ) : (
          <ul className="bc-card-grid">
            {active.map((coffee) => (
              <CoffeeCard key={coffee.id} coffee={coffee} locale={locale} />
            ))}
          </ul>
        )}
      </section>

      {retired.length > 0 ? (
        <section className={styles.section} aria-labelledby="past-coffees">
          <h2 id="past-coffees">{t('catalog.roasterDetail.retiredHeading')}</h2>
          <p className="bc-muted">{t('catalog.roasterDetail.retiredBody')}</p>
          <ul className="bc-card-grid">
            {retired.map((coffee) => (
              <CoffeeCard key={coffee.id} coffee={coffee} locale={locale} />
            ))}
          </ul>
        </section>
      ) : null}

      {origins.length > 0 ? (
        <section className={styles.section} aria-labelledby="their-origins">
          <h2 id="their-origins">{t('catalog.roasterDetail.originsHeading')}</h2>
          <ul className={styles.related}>
            {origins.map((country) => (
              <li key={country}>
                <Link href={`/coffee?origin=${encodeURIComponent(country)}`}>
                  {t('catalog.roasterDetail.allCountryCoffees', { country })}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={styles.section} aria-labelledby="keep-looking">
        <h2 id="keep-looking">{t('catalog.keepLooking')}</h2>
        <ul className={styles.related}>
          <li>
            <Link href={`/coffee?roaster=${roaster.slug}`}>
              {t('catalog.roasterDetail.filterToRoaster', { name: roaster.name })}
            </Link>
          </li>
          <li>
            <Link href="/roaster">{t('catalog.roasterDetail.allRoasters')}</Link>
          </li>
          <li>
            <Link href="/recipes">{t('catalog.elsewhere.recipes')}</Link>
          </li>
        </ul>
      </section>
    </div>
  );
}
