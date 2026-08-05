import { type Metadata } from 'next';
import Link from 'next/link';
import { Breadcrumbs } from '../../components/catalog/breadcrumbs';
import { loadRoasters, type RoasterSummary } from '../../components/catalog/catalog-api';
import styles from '../../components/catalog/catalog.module.css';
import { RoasterCard } from '../../components/catalog/entity-cards';
import { Pagination } from '../../components/catalog/filter-bar';
import { JsonLd, readCspNonce } from '../../components/catalog/json-ld';
import { hubMetadata } from '../../lib/seo';
import { breadcrumbJsonLd, itemListJsonLd } from '../../lib/structured-data';

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
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function one(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value === '' ? undefined : value;
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const params = await searchParams;
  return hubMetadata({
    title: 'Coffee roasters',
    description:
      'Specialty coffee roasters and the coffees they roast — origins, processes, tasting notes and the community recipes for brewing them.',
    basePath: '/roaster',
    cursor: one(params['cursor']),
  });
}

export default async function RoasterHubPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const cursor = one(params['cursor']);

  const [result, nonce] = await Promise.all([
    loadRoasters({ cursor, limit: PAGE_SIZE }),
    readCspNonce(),
  ]);

  const roasters: RoasterSummary[] = result.status === 'ok' ? result.data.items : [];
  const nextCursor = result.status === 'ok' ? result.data.next_cursor : null;

  const breadcrumbs = [
    { name: 'Home', path: '/' },
    { name: 'Roasters', path: '/roaster' },
  ];

  return (
    <div className="bc-stack">
      <JsonLd
        nonce={nonce}
        documents={[
          breadcrumbJsonLd(breadcrumbs),
          itemListJsonLd(
            'Coffee roasters',
            roasters.map((roaster) => ({
              name: roaster.name,
              path: `/roaster/${roaster.slug}`,
            })),
          ),
        ]}
      />

      <Breadcrumbs entries={breadcrumbs} />

      <h1>Coffee roasters</h1>
      <p className="bc-lede">
        The people who decide how a green coffee tastes by the time it reaches you. Every
        profile lists their coffees with full provenance — and the brews the community has
        logged on them.
      </p>

      <section aria-labelledby="results">
        <h2 id="results" className="bc-visually-hidden">
          Roasters
        </h2>

        {result.status === 'error' ? (
          <p className="bc-muted">
            We could not load the roaster list just now — that is on us, not on you. Try again
            in a moment.
          </p>
        ) : roasters.length === 0 ? (
          <div className={styles.explainer}>
            <p>
              No roasters listed yet. We are still filling the shelves — and we would rather
              show you an empty page honestly than pad it out.
            </p>
            <p>
              <Link href="/coffee">Browse coffees instead</Link>.
            </p>
          </div>
        ) : (
          <ul className="bc-card-grid">
            {roasters.map((roaster) => (
              <RoasterCard key={roaster.id} roaster={roaster} />
            ))}
          </ul>
        )}

        <Pagination
          basePath="/roaster"
          filters={{}}
          nextCursor={nextCursor}
          itemCount={roasters.length}
          isCursorPage={cursor !== undefined}
        />
      </section>

      <section className={styles.section} aria-labelledby="elsewhere">
        <h2 id="elsewhere">Elsewhere in the catalogue</h2>
        <ul className={styles.related}>
          <li>
            <Link href="/coffee">Coffees</Link>
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
