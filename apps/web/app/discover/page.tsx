import { type Metadata } from 'next';
import { CoffeeCard } from '../../components/discover/coffee-card';
import { EntitySearch } from '../../components/discover/entity-search';
import { Alert } from '../../components/ui/alert';
import { apiFetch, type CoffeeSummary, type Paginated } from '../../lib/api';
import { fetchClientConfig } from '../../lib/client-config';

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

export default async function DiscoverPage() {
  const [result, config] = await Promise.all([loadCoffees(), fetchClientConfig()]);

  return (
    <div className="bc-stack">
      <h1>Discover coffee</h1>
      <p className="bc-lede">
        Origins, processes and roasters, described in plain language. Nothing here assumes
        you already know what a washed Yirgacheffe tastes like — that is what the notes
        are for.
      </p>

      {config.features.entitySearch ? <EntitySearch /> : null}

      <section aria-labelledby="coffees-heading">
        <h2 id="coffees-heading">Coffees</h2>

        {result.status === 'error' ? (
          <Alert tone="error" title="We could not load the catalogue just now.">
            That is on us, not on you. Refresh in a moment — the search box above may still
            work.
          </Alert>
        ) : result.coffees.length === 0 ? (
          <Alert tone="info" title="Nothing here yet.">
            We are still filling the shelves. Check back shortly, or search for a roaster
            you already like.
          </Alert>
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
