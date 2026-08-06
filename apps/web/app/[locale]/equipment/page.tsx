import { type Metadata } from 'next';
import { localeParam, translator } from '../../../lib/locale-server';
import { LocaleLink as Link } from '../../../components/locale-link';
import { Breadcrumbs } from '../../../components/catalog/breadcrumbs';
import {
  EQUIPMENT_CATEGORIES,
  loadEquipmentBrands,
  loadEquipmentList,
  type EquipmentCategory,
  type EquipmentSummary,
} from '../../../components/catalog/catalog-api';
import styles from '../../../components/catalog/catalog.module.css';
import { catalogCopy } from '../../../components/catalog/copy';
import { EquipmentCard } from '../../../components/catalog/entity-cards';
import { FilterBar, Pagination } from '../../../components/catalog/filter-bar';
import { JsonLd, readCspNonce } from '../../../components/catalog/json-ld';
import { hubMetadata } from '../../../lib/seo';
import { breadcrumbJsonLd, itemListJsonLd } from '../../../lib/structured-data';

/**
 * Equipment hub (CAT-09).
 *
 * `/equipment?category=grinder` is the page that catches "best grinder" traffic
 * and routes it to the per-grinder conversion tables, which are the thing worth
 * arriving for. The category copy is rendered for filtered views so the page
 * says something specific rather than being a naked grid.
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

function readFilters(searchParams: Record<string, string | string[] | undefined>) {
  const rawCategory = one(searchParams['category']);
  const category = (EQUIPMENT_CATEGORIES as readonly string[]).includes(rawCategory ?? '')
    ? (rawCategory as EquipmentCategory)
    : undefined;
  return { category, brand: one(searchParams['brand']) };
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const locale = localeParam((await params).locale);
  const copy = catalogCopy(locale);
  const t = translator(locale);
  const search = await searchParams;
  const filters = readFilters(search);

  const noun = filters.category
    ? copy.EQUIPMENT_CATEGORY_PLURAL[filters.category].toLowerCase()
    : t('catalog.equipmentHub.noun');
  const brand = filters.brand ? t('catalog.equipmentHub.fromBrand', { brand: filters.brand }) : '';
  const phrase = `${noun}${brand}`;

  return hubMetadata({
    title: `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}`,
    description: t('catalog.equipmentHub.metaDescription', { noun: phrase }),
    basePath: '/equipment',
    filters,
    cursor: one(search['cursor']),
  });
}

export default async function EquipmentHubPage({ params, searchParams }: PageProps) {
  const locale = localeParam((await params).locale);
  const copy = catalogCopy(locale);
  const t = translator(locale);
  const search = await searchParams;
  const filters = readFilters(search);
  const cursor = one(search['cursor']);

  const [result, brands, nonce] = await Promise.all([
    loadEquipmentList({ ...filters, cursor, limit: PAGE_SIZE }),
    loadEquipmentBrands(),
    readCspNonce(),
  ]);

  const equipment: EquipmentSummary[] = result.status === 'ok' ? result.data.items : [];
  const nextCursor = result.status === 'ok' ? result.data.next_cursor : null;
  const hasActiveFilters = Object.values(filters).some((value) => value !== undefined);

  const heading = filters.category
    ? `${copy.EQUIPMENT_CATEGORY_PLURAL[filters.category]}${
        filters.brand ? t('catalog.equipmentHub.fromBrand', { brand: filters.brand }) : ''
      }`
    : filters.brand
      ? t('catalog.equipmentHub.brandTitle', { brand: filters.brand })
      : t('catalog.equipmentHub.title');

  const breadcrumbs = [
    { name: t('catalog.crumbs.home'), path: '/' },
    { name: t('catalog.crumbs.equipment'), path: '/equipment' },
  ];

  return (
    <div className="bc-stack">
      <JsonLd
        nonce={nonce}
        documents={[
          breadcrumbJsonLd(breadcrumbs),
          itemListJsonLd(
            heading,
            equipment.map((item) => ({
              name: `${item.brand.name} ${item.name}`,
              path: `/equipment/${item.slug}`,
            })),
          ),
        ]}
      />

      <Breadcrumbs entries={breadcrumbs} locale={locale} />

      <h1>{heading}</h1>
      <p className="bc-lede">
        {filters.category
          ? copy.EQUIPMENT_CATEGORY_COPY[filters.category]
          : t('catalog.equipmentHub.lede')}
      </p>

      <FilterBar
        action="/equipment"
        locale={locale}
        legend={t('catalog.filters.equipmentLegend')}
        hasActiveFilters={hasActiveFilters}
        selects={[
          {
            name: 'category',
            label: t('catalog.filters.category'),
            anyLabel: t('catalog.filters.anyCategory'),
            selected: filters.category,
            options: EQUIPMENT_CATEGORIES.map((category) => ({
              value: category,
              label: copy.EQUIPMENT_CATEGORY_PLURAL[category],
            })),
          },
          {
            name: 'brand',
            label: t('catalog.filters.brand'),
            anyLabel: t('catalog.filters.anyBrand'),
            selected: filters.brand,
            options: brands.map((brand) => ({ value: brand.name, label: brand.name })),
          },
        ]}
      />

      <section aria-labelledby="results">
        <h2 id="results" className="bc-visually-hidden">
          {t('catalog.results')}
        </h2>

        {result.status === 'error' ? (
          <p className="bc-muted">{t('catalog.equipmentHub.loadError')}</p>
        ) : equipment.length === 0 ? (
          <div className={styles.explainer}>
            <p>{t('catalog.equipmentHub.emptyBody')}</p>
            <p>
              <Link href="/equipment">{t('catalog.equipmentHub.emptyClear')}</Link>.
            </p>
          </div>
        ) : (
          <ul className="bc-card-grid">
            {equipment.map((item) => (
              <EquipmentCard key={item.id} equipment={item} locale={locale} />
            ))}
          </ul>
        )}

        <Pagination
          basePath="/equipment"
          locale={locale}
          filters={filters}
          nextCursor={nextCursor}
          itemCount={equipment.length}
          isCursorPage={cursor !== undefined}
        />
      </section>

      <section className={styles.section} aria-labelledby="by-category">
        <h2 id="by-category">{t('catalog.equipmentHub.byCategory')}</h2>
        <ul className={styles.related}>
          {EQUIPMENT_CATEGORIES.map((category) => (
            <li key={category}>
              <Link href={`/equipment?category=${category}`}>
                {copy.EQUIPMENT_CATEGORY_PLURAL[category]}
              </Link>
            </li>
          ))}
        </ul>
        <p className="bc-muted">{t('catalog.equipmentHub.byCategoryNote')}</p>
      </section>

      <section className={styles.section} aria-labelledby="elsewhere">
        <h2 id="elsewhere">{t('catalog.elsewhere.heading')}</h2>
        <ul className={styles.related}>
          <li>
            <Link href="/coffee">{t('catalog.elsewhere.coffees')}</Link>
          </li>
          <li>
            <Link href="/roaster">{t('catalog.elsewhere.roasters')}</Link>
          </li>
          <li>
            <Link href="/recipes">{t('catalog.elsewhere.recipes')}</Link>
          </li>
        </ul>
      </section>
    </div>
  );
}
