import { type Metadata } from 'next';
import { CoffeeCard } from '../../../components/discover/coffee-card';
import { AddCoffee } from '../../../components/coffee/add-coffee';
import { localeParam, translator } from '../../../lib/locale-server';
import { EntitySearch } from '../../../components/discover/entity-search';
import { Alert } from '../../../components/ui/alert';
import { apiFetch, type CoffeeSummary, type Paginated } from '../../../lib/api';
import { fetchClientConfig } from '../../../lib/client-config';

export const metadata: Metadata = {
  title: 'Discover coffee',
  description:
    'Browse specialty coffees by origin, process and roast level — with the tasting notes and the roasters behind them.',
  alternates: { canonical: '/discover' },
  openGraph: {
    title: 'Discover coffee · BrewCult',
    description:
      'Browse specialty coffees by origin, process and roast level — with tasting notes and the roasters behind them.',
    url: '/discover',
  },
};

/**
 * This is the SEO surface, so it is server-rendered with real markup and
 * revalidated rather than fetched in the browser. Catalog data is public, so no
 * cookies are forwarded — that keeps the response cacheable.
 */
export const revalidate = 300;

type LoadResult =
  | { status: 'ok'; coffees: CoffeeSummary[] }
  | { status: 'error' };

async function loadCoffees(): Promise<LoadResult> {
  try {
    const response = await apiFetch<Paginated<CoffeeSummary> | CoffeeSummary[]>(
      '/api/v1/coffees',
      { refreshOn401: false, next: { revalidate } },
    );
    const items = Array.isArray(response) ? response : (response?.items ?? []);
    return { status: 'ok', coffees: items };
  } catch {
    return { status: 'error' };
  }
}

export default async function DiscoverPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = localeParam((await params).locale);
  const t = translator(locale);
  const [result, config] = await Promise.all([loadCoffees(), fetchClientConfig()]);

  return (
    <div className="bc-stack">
      <h1>{t('discover.title')}</h1>
      <p className="bc-lede">{t('discover.lede')}</p>

      {config.features.entitySearch ? <EntitySearch /> : null}

      {/*
        Drinking something that is not here? Photograph the bag.
        Deliberately ABOVE the grid rather than buried at the bottom: an empty
        catalogue is exactly when somebody should be invited to fill it, and a
        page that says "nothing here yet" with no way to act is a dead end.
      */}
      <section aria-labelledby="add-coffee-heading" className="bc-stack">
        <h2 id="add-coffee-heading" className="bc-visually-hidden">
          {t('addCoffee.action')}
        </h2>
        <AddCoffee />
      </section>

      <section aria-labelledby="coffees-heading">
        <h2 id="coffees-heading">{t('discover.coffees')}</h2>

        {result.status === 'error' ? (
          <Alert tone="error" title={t('errors.server')}>
            {t('discover.loadError')}
          </Alert>
        ) : result.coffees.length === 0 ? (
          <Alert tone="info">{t('discover.empty')}</Alert>
        ) : (
          <ul className="bc-card-grid">
            {result.coffees.map((coffee) => (
              <CoffeeCard key={coffee.id ?? coffee.slug} coffee={coffee} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
