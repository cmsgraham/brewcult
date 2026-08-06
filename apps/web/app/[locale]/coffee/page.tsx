import { type Metadata } from 'next';
import { localeParam } from '../../../lib/locale-server';
import Link from 'next/link';
import { Breadcrumbs } from '../../../components/catalog/breadcrumbs';
import {
  INTENDED_USES,
  LOT_PROCESSES,
  ROAST_LEVELS,
  loadCoffees,
  loadOrigins,
  type CoffeeSummary,
} from '../../../components/catalog/catalog-api';
import styles from '../../../components/catalog/catalog.module.css';
import { catalogCopy } from '../../../components/catalog/copy';
import { CoffeeCard } from '../../../components/catalog/entity-cards';
import { FilterBar, Pagination } from '../../../components/catalog/filter-bar';
import { JsonLd, readCspNonce } from '../../../components/catalog/json-ld';
import { hubMetadata } from '../../../lib/seo';
import { breadcrumbJsonLd, itemListJsonLd } from '../../../lib/structured-data';

/**
 * Coffee hub — the faceted landing page (§23.1).
 *
 * The filters are the SEO product here: `/coffee?origin=Ethiopia&process=washed`
 * is "washed Ethiopian coffee", a query with real intent, and it
 * self-canonicalises so it can rank on its own. Cursor pages are `noindex,
 * follow` (see `lib/seo.ts`) — page 4 of an opaque keyset is not a landing page.
 *
 * Filter values map 1:1 onto the catalog API's query schema, so a hand-edited
 * URL can produce an empty result but never a 400.
 */
export const revalidate = 300;

const PAGE_SIZE = 24;

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** First value only — `?process=washed&process=natural` is a client bug, and
 *  guessing which one they meant is worse than taking the first. */
function one(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value === '' ? undefined : value;
}

/** Only values the API's enum accepts survive. */
function oneOf<T extends string>(
  value: string | string[] | undefined,
  allowed: readonly T[],
): T | undefined {
  const raw = one(value);
  return raw !== undefined && (allowed as readonly string[]).includes(raw) ? (raw as T) : undefined;
}

function readFilters(searchParams: Record<string, string | string[] | undefined>) {
  return {
    origin: one(searchParams['origin']),
    process: oneOf(searchParams['process'], LOT_PROCESSES),
    roast_level: oneOf(searchParams['roast_level'], ROAST_LEVELS),
    intended_use: oneOf(searchParams['intended_use'], INTENDED_USES),
    roaster: one(searchParams['roaster']),
  };
}

/** "Washed Ethiopian coffee" — a real title for a real query, built from the
 *  active facets rather than a generic "Coffee (filtered)". */
function titleFor(
  filters: ReturnType<typeof readFilters>,
  locale: string,
): { title: string; description: string } {
  const copy = catalogCopy(locale);
  const parts: string[] = [];
  if (filters.roast_level) parts.push(copy.ROAST_LEVEL_LABEL[filters.roast_level].toLowerCase());
  if (filters.process) parts.push(copy.PROCESS_LABEL[filters.process].toLowerCase());
  const noun = parts.length > 0 ? `${parts.join(' ')} coffee` : 'coffee';
  const where = filters.origin ? ` from ${filters.origin}` : '';
  const use = filters.intended_use
    ? ` for ${copy.INTENDED_USE_LABEL[filters.intended_use].toLowerCase()}`
    : '';

  const headline = `${noun.charAt(0).toUpperCase()}${noun.slice(1)}${where}${use}`;
  return {
    title: headline,
    description: `Browse ${noun}${where}${use} — origin, farm, process, varietal, altitude and roast level for every bag, with the roaster behind it and community brewing recipes.`,
  };
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const locale = localeParam((await params).locale);
  const search = await searchParams;
  const filters = readFilters(search);
  const { title, description } = titleFor(filters, locale);

  return hubMetadata({
    title,
    description,
    basePath: '/coffee',
    filters,
    cursor: one(search['cursor']),
  });
}

export default async function CoffeeHubPage({ params, searchParams }: PageProps) {
  const locale = localeParam((await params).locale);
  const copy = catalogCopy(locale);
  const search = await searchParams;
  const filters = readFilters(search);
  const cursor = one(search['cursor']);

  const [result, origins, nonce] = await Promise.all([
    loadCoffees({ ...filters, cursor, limit: PAGE_SIZE }),
    loadOrigins(),
    readCspNonce(),
  ]);

  const coffees: CoffeeSummary[] = result.status === 'ok' ? result.data.items : [];
  const nextCursor = result.status === 'ok' ? result.data.next_cursor : null;
  const { title } = titleFor(filters, locale);
  const hasActiveFilters = Object.values(filters).some((value) => value !== undefined);

  const breadcrumbs = [
    { name: 'Home', path: '/' },
    { name: 'Coffee', path: '/coffee' },
  ];

  // Countries, de-duplicated: the API matches `origin` on country name, so
  // offering regions here would build URLs that silently match nothing.
  const countries = [...new Set(origins.map((origin) => origin.country))].sort();

  return (
    <div className="bc-stack">
      <JsonLd
        nonce={nonce}
        documents={[
          breadcrumbJsonLd(breadcrumbs),
          itemListJsonLd(
            title,
            coffees.map((coffee) => ({ name: coffee.name, path: `/coffee/${coffee.slug}` })),
          ),
        ]}
      />

      <Breadcrumbs entries={breadcrumbs} />

      <h1>{title}</h1>
      <p className="bc-lede">
        Every coffee here carries where it grew, how it was processed and how far it was
        roasted — in plain language, because none of that is obvious and pretending otherwise
        helps nobody.
      </p>

      <FilterBar
        action="/coffee"
        legend="Filter coffees"
        hasActiveFilters={hasActiveFilters}
        selects={[
          {
            name: 'origin',
            label: 'Origin',
            anyLabel: 'Anywhere',
            selected: filters.origin,
            options: countries.map((country) => ({ value: country, label: country })),
          },
          {
            name: 'process',
            label: 'Process',
            anyLabel: 'Any process',
            selected: filters.process,
            options: LOT_PROCESSES.map((process) => ({
              value: process,
              label: copy.PROCESS_LABEL[process],
            })),
          },
          {
            name: 'roast_level',
            label: 'Roast level',
            anyLabel: 'Any roast',
            selected: filters.roast_level,
            options: ROAST_LEVELS.map((level) => ({
              value: level,
              label: copy.ROAST_LEVEL_LABEL[level],
            })),
          },
          {
            name: 'intended_use',
            label: 'Brewed as',
            anyLabel: 'Either',
            selected: filters.intended_use,
            options: INTENDED_USES.map((use) => ({ value: use, label: copy.INTENDED_USE_LABEL[use] })),
          },
        ]}
      />

      <section aria-labelledby="results">
        <h2 id="results" className="bc-visually-hidden">
          Results
        </h2>

        {result.status === 'error' ? (
          <p className="bc-muted">
            We could not load the catalogue just now — that is on us, not on you. Refresh in a
            moment.
          </p>
        ) : coffees.length === 0 ? (
          <div className={styles.explainer}>
            <p>
              Nothing matches those filters yet. The catalogue is still growing, so an empty
              result usually means &ldquo;not indexed yet&rdquo; rather than &ldquo;does not
              exist&rdquo;.
            </p>
            <p>
              <Link href="/coffee">Clear the filters</Link> or{' '}
              <Link href="/roaster">start from a roaster</Link> instead.
            </p>
          </div>
        ) : (
          <ul className="bc-card-grid">
            {coffees.map((coffee) => (
              <CoffeeCard key={coffee.id} coffee={coffee} locale={locale} />
            ))}
          </ul>
        )}

        <Pagination
          basePath="/coffee"
          filters={filters}
          nextCursor={nextCursor}
          itemCount={coffees.length}
          isCursorPage={cursor !== undefined}
        />
      </section>

      <section className={styles.section} aria-labelledby="elsewhere">
        <h2 id="elsewhere">Elsewhere in the catalogue</h2>
        <ul className={styles.related}>
          <li>
            <Link href="/roaster">Roasters</Link>
          </li>
          <li>
            <Link href="/equipment">Brewers and grinders</Link>
          </li>
          <li>
            <Link href="/recipes">Brewing recipes</Link>
          </li>
        </ul>
      </section>
    </div>
  );
}
