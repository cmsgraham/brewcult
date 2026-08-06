import { type Metadata } from 'next';
import { localeParam, translator } from '../../../lib/locale-server';
import { LocaleLink as Link } from '../../../components/locale-link';
import { Breadcrumbs } from '../../../components/catalog/breadcrumbs';
import { loadRoasters, type RoasterSummary } from '../../../components/catalog/catalog-api';
import styles from '../../../components/catalog/catalog.module.css';
import { RoasterCard } from '../../../components/catalog/entity-cards';
import { Pagination } from '../../../components/catalog/filter-bar';
import { JsonLd, readCspNonce } from '../../../components/catalog/json-ld';
import { hubMetadata } from '../../../lib/seo';
import { breadcrumbJsonLd, itemListJsonLd } from '../../../lib/structured-data';

/**
 * Roaster hub (CAT-09).
 *
 * The only filter the API offers on roasters is `verified`, so that is the only
 * filter offered here — a select box whose options do not map to real query
 * params would be theatre, and the empty results would be indistinguishable
 * from a bug.
 */
export const revalidate = 300;

const PAGE_SIZE = 36;

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function one(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value === '' ? undefined : value;
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const locale = localeParam((await params).locale);
  const t = translator(locale);
  const search = await searchParams;
  return hubMetadata({
    title: t('catalog.roasterHub.title'),
    description: t('catalog.roasterHub.metaDescription'),
    basePath: '/roaster',
    cursor: one(search['cursor']),
  });
}

export default async function RoasterHubPage({ params, searchParams }: PageProps) {
  const locale = localeParam((await params).locale);
  const t = translator(locale);
  const search = await searchParams;
  const cursor = one(search['cursor']);

  const [result, nonce] = await Promise.all([
    loadRoasters({ cursor, limit: PAGE_SIZE }),
    readCspNonce(),
  ]);

  const roasters: RoasterSummary[] = result.status === 'ok' ? result.data.items : [];
  const nextCursor = result.status === 'ok' ? result.data.next_cursor : null;

  const breadcrumbs = [
    { name: t('catalog.crumbs.home'), path: '/' },
    { name: t('catalog.crumbs.roasters'), path: '/roaster' },
  ];

  return (
    <div className="bc-stack">
      <JsonLd
        nonce={nonce}
        documents={[
          breadcrumbJsonLd(breadcrumbs),
          itemListJsonLd(
            t('catalog.roasterHub.title'),
            roasters.map((roaster) => ({
              name: roaster.name,
              path: `/roaster/${roaster.slug}`,
            })),
          ),
        ]}
      />

      <Breadcrumbs entries={breadcrumbs} locale={locale} />

      <h1>{t('catalog.roasterHub.title')}</h1>
      <p className="bc-lede">{t('catalog.roasterHub.lede')}</p>

      <section aria-labelledby="results">
        <h2 id="results" className="bc-visually-hidden">
          {t('catalog.roasterHub.sectionHeading')}
        </h2>

        {result.status === 'error' ? (
          <p className="bc-muted">{t('catalog.roasterHub.loadError')}</p>
        ) : roasters.length === 0 ? (
          <div className={styles.explainer}>
            <p>{t('catalog.roasterHub.emptyBody')}</p>
            <p>
              <Link href="/coffee">{t('catalog.roasterHub.emptyLink')}</Link>.
            </p>
          </div>
        ) : (
          <ul className="bc-card-grid">
            {roasters.map((roaster) => (
              <RoasterCard key={roaster.id} roaster={roaster} locale={locale} />
            ))}
          </ul>
        )}

        <Pagination
          basePath="/roaster"
          locale={locale}
          filters={{}}
          nextCursor={nextCursor}
          itemCount={roasters.length}
          isCursorPage={cursor !== undefined}
        />
      </section>

      <section className={styles.section} aria-labelledby="elsewhere">
        <h2 id="elsewhere">{t('catalog.elsewhere.heading')}</h2>
        <ul className={styles.related}>
          <li>
            <Link href="/coffee">{t('catalog.elsewhere.coffees')}</Link>
          </li>
          <li>
            <Link href="/equipment">{t('catalog.elsewhere.equipment')}</Link>
          </li>
          <li>
            <Link href="/recipes">{t('catalog.elsewhere.recipes')}</Link>
          </li>
        </ul>
      </section>
    </div>
  );
}
