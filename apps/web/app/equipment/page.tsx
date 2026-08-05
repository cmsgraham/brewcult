import { type Metadata } from 'next';
import Link from 'next/link';
import { Breadcrumbs } from '../../components/catalog/breadcrumbs';
import {
  EQUIPMENT_CATEGORIES,
  loadEquipmentBrands,
  loadEquipmentList,
  type EquipmentCategory,
  type EquipmentSummary,
} from '../../components/catalog/catalog-api';
import styles from '../../components/catalog/catalog.module.css';
import {
  EQUIPMENT_CATEGORY_COPY,
  EQUIPMENT_CATEGORY_PLURAL,
} from '../../components/catalog/copy';
import { EquipmentCard } from '../../components/catalog/entity-cards';
import { FilterBar, Pagination } from '../../components/catalog/filter-bar';
import { JsonLd, readCspNonce } from '../../components/catalog/json-ld';
import { hubMetadata } from '../../lib/seo';
import { breadcrumbJsonLd, itemListJsonLd } from '../../lib/structured-data';

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

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const params = await searchParams;
  const filters = readFilters(params);

  const noun = filters.category
    ? EQUIPMENT_CATEGORY_PLURAL[filters.category].toLowerCase()
    : 'coffee equipment';
  const brand = filters.brand ? ` from ${filters.brand}` : '';

  return hubMetadata({
    title: `${noun.charAt(0).toUpperCase()}${noun.slice(1)}${brand}`,
    description: `Specifications, brewing recipes and community grind data for ${noun}${brand}. Every grinder page carries crowd-sourced setting conversions with the confidence and sample size shown.`,
    basePath: '/equipment',
    filters,
    cursor: one(params['cursor']),
  });
}

export default async function EquipmentHubPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const filters = readFilters(params);
  const cursor = one(params['cursor']);

  const [result, brands, nonce] = await Promise.all([
    loadEquipmentList({ ...filters, cursor, limit: PAGE_SIZE }),
    loadEquipmentBrands(),
    readCspNonce(),
  ]);

  const equipment: EquipmentSummary[] = result.status === 'ok' ? result.data.items : [];
  const nextCursor = result.status === 'ok' ? result.data.next_cursor : null;
  const hasActiveFilters = Object.values(filters).some((value) => value !== undefined);

  const heading = filters.category
    ? `${EQUIPMENT_CATEGORY_PLURAL[filters.category]}${filters.brand ? ` from ${filters.brand}` : ''}`
    : filters.brand
      ? `Equipment from ${filters.brand}`
      : 'Brewers, grinders and gear';

  const breadcrumbs = [
    { name: 'Home', path: '/' },
    { name: 'Equipment', path: '/equipment' },
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

      <Breadcrumbs entries={breadcrumbs} />

      <h1>{heading}</h1>
      <p className="bc-lede">
        {filters.category
          ? EQUIPMENT_CATEGORY_COPY[filters.category]
          : 'Gear pages exist to answer one question honestly: what does this thing actually change in the cup? No brand rankings, no "you need to upgrade" — specs, recipes and what the community has measured.'}
      </p>

      <FilterBar
        action="/equipment"
        legend="Filter equipment"
        hasActiveFilters={hasActiveFilters}
        selects={[
          {
            name: 'category',
            label: 'Category',
            anyLabel: 'Everything',
            selected: filters.category,
            options: EQUIPMENT_CATEGORIES.map((category) => ({
              value: category,
              label: EQUIPMENT_CATEGORY_PLURAL[category],
            })),
          },
          {
            name: 'brand',
            label: 'Brand',
            anyLabel: 'Any brand',
            selected: filters.brand,
            options: brands.map((brand) => ({ value: brand.name, label: brand.name })),
          },
        ]}
      />

      <section aria-labelledby="results">
        <h2 id="results" className="bc-visually-hidden">
          Results
        </h2>

        {result.status === 'error' ? (
          <p className="bc-muted">
            We could not load the equipment list just now — that is on us, not on you. Try
            again shortly.
          </p>
        ) : equipment.length === 0 ? (
          <div className={styles.explainer}>
            <p>
              Nothing matches those filters yet. If your grinder or brewer is missing, that is
              a gap in our catalogue — not a sign it is the wrong gear.
            </p>
            <p>
              <Link href="/equipment">Clear the filters</Link>.
            </p>
          </div>
        ) : (
          <ul className="bc-card-grid">
            {equipment.map((item) => (
              <EquipmentCard key={item.id} equipment={item} />
            ))}
          </ul>
        )}

        <Pagination
          basePath="/equipment"
          filters={filters}
          nextCursor={nextCursor}
          itemCount={equipment.length}
          isCursorPage={cursor !== undefined}
        />
      </section>

      <section className={styles.section} aria-labelledby="by-category">
        <h2 id="by-category">Browse by category</h2>
        <ul className={styles.related}>
          {EQUIPMENT_CATEGORIES.map((category) => (
            <li key={category}>
              <Link href={`/equipment?category=${category}`}>
                {EQUIPMENT_CATEGORY_PLURAL[category]}
              </Link>
            </li>
          ))}
        </ul>
        <p className="bc-muted">
          Grinder pages carry community grind-setting conversions — the closest thing there is
          to a straight answer to &ldquo;what number do I use on mine?&rdquo;, with the
          uncertainty stated rather than hidden.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="elsewhere">
        <h2 id="elsewhere">Elsewhere in the catalogue</h2>
        <ul className={styles.related}>
          <li>
            <Link href="/coffee">Coffees</Link>
          </li>
          <li>
            <Link href="/roaster">Roasters</Link>
          </li>
          <li>
            <Link href="/recipes">Brewing recipes</Link>
          </li>
        </ul>
      </section>
    </div>
  );
}
