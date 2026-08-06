import { type Metadata } from 'next';
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
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const result = await loadRoaster(slug);
  if (result.status !== 'ok') return notFoundMetadata('Roaster');

  const roaster = result.data;
  return roasterMetadata({
    slug: roaster.slug,
    name: roaster.name,
    location: roaster.location ?? null,
    coffeeCount: roaster.coffee_count ?? roaster.coffees?.length ?? 0,
  });
}

export default async function RoasterDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const [result, nonce] = await Promise.all([loadRoaster(slug), readCspNonce()]);

  if (result.status === 'missing') notFound();
  if (result.status === 'error') {
    return (
      <div className="bc-stack">
        <h1>We could not load this roaster</h1>
        <p className="bc-lede">
          That is on us, not on you. Try again shortly, or{' '}
          <Link href="/roaster">browse the other roasters</Link>.
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
    { name: 'Home', path: '/' },
    { name: 'Roasters', path: '/roaster' },
    { name: roaster.name, path: `/roaster/${roaster.slug}` },
  ];

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

      <Breadcrumbs entries={breadcrumbs} />

      <header className={styles.header}>
        <p className={styles.eyebrow}>Roaster</p>
        <h1>{roaster.name}</h1>
        <p className="bc-lede">
          {roaster.description ??
            `${roaster.name} has ${coffees.length === 1 ? 'one coffee' : `${coffees.length} coffees`} in the BrewCult catalogue${
              roaster.location ? `, roasted in ${roaster.location}` : ''
            }. Each one carries its origin, process and roast level, plus whatever the community has worked out about brewing it.`}
        </p>
      </header>

      <section aria-labelledby="profile">
        <h2 id="profile">Profile</h2>
        <SpecList
          rows={[
            { label: 'Location', value: roaster.location ?? null },
            {
              label: 'Coffees listed',
              value: coffees.length > 0 ? String(coffees.length) : null,
            },
            {
              label: 'Origins they buy from',
              value: origins.length > 0 ? origins.join(', ') : null,
            },
            {
              label: 'Verified',
              value: roaster.verified
                ? 'Claimed and verified by the roaster'
                : 'Not claimed yet — this profile is maintained editorially',
            },
            {
              label: 'Website',
              value: roaster.website_url ?? null,
              ...(roaster.website_url ? { href: roaster.website_url } : {}),
            },
          ]}
        />
      </section>

      <section className={styles.section} aria-labelledby="coffees">
        <h2 id="coffees">Their coffees</h2>
        {active.length === 0 && retired.length === 0 ? (
          <p className="bc-muted">
            No coffees listed for {roaster.name} yet. If you have a bag from them, the catalogue
            is exactly where it belongs.
          </p>
        ) : (
          <ul className="bc-card-grid">
            {active.map((coffee) => (
              <CoffeeCard key={coffee.id} coffee={coffee} />
            ))}
          </ul>
        )}
      </section>

      {retired.length > 0 ? (
        <section className={styles.section} aria-labelledby="past-coffees">
          <h2 id="past-coffees">No longer roasted</h2>
          <p className="bc-muted">
            Lots rotate with the harvest. These pages stay up because the recipes and notes
            attached to them are still useful — and because a similar lot often comes back.
          </p>
          <ul className="bc-card-grid">
            {retired.map((coffee) => (
              <CoffeeCard key={coffee.id} coffee={coffee} />
            ))}
          </ul>
        </section>
      ) : null}

      {origins.length > 0 ? (
        <section className={styles.section} aria-labelledby="their-origins">
          <h2 id="their-origins">Origins they work with</h2>
          <ul className={styles.related}>
            {origins.map((country) => (
              <li key={country}>
                <Link href={`/coffee?origin=${encodeURIComponent(country)}`}>
                  All {country} coffees
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={styles.section} aria-labelledby="keep-looking">
        <h2 id="keep-looking">Keep looking</h2>
        <ul className={styles.related}>
          <li>
            <Link href={`/coffee?roaster=${roaster.slug}`}>
              Filter the catalogue to {roaster.name}
            </Link>
          </li>
          <li>
            <Link href="/roaster">All roasters</Link>
          </li>
          <li>
            <Link href="/recipes">Brewing recipes</Link>
          </li>
        </ul>
      </section>
    </div>
  );
}
