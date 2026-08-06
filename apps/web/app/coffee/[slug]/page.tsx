import { type Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Breadcrumbs } from '../../../components/catalog/breadcrumbs';
import {
  loadCoffee,
  loadCoffees,
  loadRecipes,
  type CoffeeDetail,
} from '../../../components/catalog/catalog-api';
import { CoffeeCard } from '../../../components/catalog/entity-cards';
import styles from '../../../components/catalog/catalog.module.css';
import {
  INTENDED_USE_COPY,
  INTENDED_USE_LABEL,
  PROCESS_LABEL,
  ROAST_LEVEL_COPY,
  ROAST_LEVEL_LABEL,
  STATUS_COPY,
  originLabel,
  processCopy,
} from '../../../components/catalog/copy';
import { CoffeeNotes } from '../../../components/coffee/coffee-notes';
import { EntityImage } from '../../../components/media/entity-image';
import { FreshnessSection } from '../../../components/catalog/freshness';
import { StartingRecipeCard } from '../../../components/ai/starting-recipe';
import { JsonLd, readCspNonce } from '../../../components/catalog/json-ld';
import { RecipesSection } from '../../../components/catalog/recipes-section';
import { Explainer, SpecList, TagList } from '../../../components/catalog/spec-list';
import { coffeeMetadata, notFoundMetadata, sentence } from '../../../lib/seo';
import { breadcrumbJsonLd, coffeeProductJsonLd } from '../../../lib/structured-data';

/**
 * Coffee detail — the primary SEO landing page (§23.1, CAT-09).
 *
 * Server-rendered with zero client JavaScript. Every upstream fetch is
 * `revalidate`-cached and the three of them run in parallel, so the render is
 * one round-trip wide, not three deep.
 *
 * The page is an entity-graph node, not a leaf (§5): it links out to the
 * roaster, the origin (as a filtered hub URL), the equipment in its recipes and
 * the roaster's other coffees. Nothing that could be a link is left as text.
 */
export const revalidate = 300;

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const result = await loadCoffee(slug);
  if (result.status !== 'ok') return notFoundMetadata('Coffee');

  const coffee = result.data;
  return coffeeMetadata({
    slug: coffee.slug,
    name: coffee.name,
    roasterName: coffee.roaster?.name ?? 'an independent roaster',
    originLabel: originLabel(coffee.origin),
    processLabel: coffee.process ? PROCESS_LABEL[coffee.process] : null,
    roastLevelLabel: coffee.roast_level ? ROAST_LEVEL_LABEL[coffee.roast_level] : null,
    tastingNotes: coffee.tasting_notes ?? [],
  });
}

/** Lede sentence — assembled from real data so no two pages read identically. */
function ledeFor(coffee: CoffeeDetail): string {
  const where = originLabel(coffee.origin);
  const process = coffee.process ? PROCESS_LABEL[coffee.process].toLowerCase() : null;
  const notes = coffee.tasting_notes?.length
    ? `The roaster tastes ${coffee.tasting_notes.join(', ')} in it.`
    : null;

  return sentence(
    where ? `A ${process ? `${process} ` : ''}coffee from ${where},` : 'A coffee',
    coffee.roaster ? `roasted by ${coffee.roaster.name}.` : '.',
    notes,
  );
}

export default async function CoffeeDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const result = await loadCoffee(slug);

  // A hard 404 for a slug that does not exist; a soft error page would be
  // indexed, which is worse than being absent.
  if (result.status === 'missing') notFound();
  if (result.status === 'error') {
    return (
      <div className="bc-stack">
        <h1>We could not load this coffee</h1>
        <p className="bc-lede">
          That is on us, not on you. Try again in a moment, or{' '}
          <Link href="/coffee">browse the rest of the catalogue</Link>.
        </p>
      </div>
    );
  }

  const coffee = result.data;
  const lot = coffee.lot;

  // Parallel, and every one of them degrades to an empty state on failure.
  const [recipes, siblings, nonce] = await Promise.all([
    loadRecipes({ coffee_product_id: coffee.id, limit: 6 }),
    coffee.roaster
      ? loadCoffees({ roaster: coffee.roaster.slug, limit: 4 })
      : Promise.resolve({ status: 'missing' } as const),
    readCspNonce(),
  ]);

  const otherCoffees =
    siblings.status === 'ok'
      ? siblings.data.items.filter((item) => item.id !== coffee.id).slice(0, 3)
      : [];

  const origin = originLabel(coffee.origin);
  const breadcrumbs = [
    { name: 'Home', path: '/' },
    { name: 'Coffee', path: '/coffee' },
    { name: coffee.name, path: `/coffee/${coffee.slug}` },
  ];

  // Equipment referenced by this coffee's recipes — an entity-graph edge that
  // only exists once recipes do (§5).
  const equipmentInRecipes =
    recipes.status === 'ok'
      ? [
          ...new Map(
            recipes.data.items
              .flatMap((recipe) => [recipe.brewer, recipe.grinder])
              .filter((item): item is NonNullable<typeof item> => item !== null && item.slug !== '')
              .map((item) => [item.slug, item]),
          ).values(),
        ]
      : [];

  return (
    <div className="bc-stack">
      <JsonLd
        nonce={nonce}
        documents={[
          coffeeProductJsonLd({
            slug: coffee.slug,
            name: coffee.name,
            description: ledeFor(coffee),
            roaster: { name: coffee.roaster.name, slug: coffee.roaster.slug },
            roastLevel: coffee.roast_level ? ROAST_LEVEL_LABEL[coffee.roast_level] : null,
            intendedUse: coffee.intended_use ? INTENDED_USE_LABEL[coffee.intended_use] : null,
            tastingNotes: coffee.tasting_notes ?? [],
            process: coffee.process ? PROCESS_LABEL[coffee.process] : null,
            varietals: lot?.varietals ?? [],
            altitudeMasl: lot?.altitude_masl ?? null,
            harvestPeriod: lot?.harvest_period ?? null,
            origin: coffee.origin ?? null,
            farmName: lot?.farm?.name ?? null,
          }),
          breadcrumbJsonLd(breadcrumbs),
        ]}
      />

      <Breadcrumbs entries={breadcrumbs} />


      {/* The bag. Usually photographed by whoever added the coffee — for a lot
          that exists for six weeks, that is the only picture there will ever
          be. `EntityImage` renders nothing at all when there is none, rather
          than a grey placeholder pretending to be one. */}
      <EntityImage entity={coffee} alt={`${coffee.roaster?.name ?? ''} ${coffee.name}`.trim()} />
      <header className={styles.header}>
        <p className={styles.eyebrow}>Coffee</p>
        <h1>{coffee.name}</h1>
        {coffee.roaster ? (
          <p className={styles.byline}>
            Roasted by <Link href={`/roaster/${coffee.roaster.slug}`}>{coffee.roaster.name}</Link>
          </p>
        ) : null}
        <p className="bc-lede">{ledeFor(coffee)}</p>
        {coffee.status !== 'active' ? (
          <p className="bc-muted">{STATUS_COPY[coffee.status]}</p>
        ) : null}
      </header>

      {coffee.tasting_notes?.length ? (
        <section aria-labelledby="tasting-notes">
          <h2 id="tasting-notes">Tasting notes</h2>
          <TagList items={coffee.tasting_notes} label="Tasting notes" />
          <p className="bc-muted">
            These are the roaster&rsquo;s words for what they found. If you taste something
            else, you are not wrong — notes are a map, not a test.
          </p>
        </section>
      ) : null}

      <section className={styles.section} aria-labelledby="provenance">
        <h2 id="provenance">Where it comes from</h2>
        <SpecList
          rows={[
            {
              label: 'Origin',
              value: origin,
              ...(coffee.origin ? { href: `/coffee?origin=${encodeURIComponent(coffee.origin.country)}` } : {}),
            },
            { label: 'Farm or station', value: lot?.farm?.name ?? null },
            {
              label: 'Process',
              value: coffee.process ? PROCESS_LABEL[coffee.process] : null,
              ...(coffee.process ? { href: `/coffee?process=${coffee.process}` } : {}),
            },
            { label: 'Process detail', value: lot?.process_detail ?? null },
            { label: 'Varietals', value: lot?.varietals?.length ? lot.varietals.join(', ') : null },
            { label: 'Altitude', value: lot?.altitude_masl ? `${lot.altitude_masl} masl` : null },
            { label: 'Harvest', value: lot?.harvest_period ?? null },
            {
              label: 'Roast level',
              value: coffee.roast_level ? ROAST_LEVEL_LABEL[coffee.roast_level] : null,
              ...(coffee.roast_level ? { href: `/coffee?roast_level=${coffee.roast_level}` } : {}),
            },
            {
              label: 'Best for',
              value: coffee.intended_use ? INTENDED_USE_LABEL[coffee.intended_use] : null,
              ...(coffee.intended_use ? { href: `/coffee?intended_use=${coffee.intended_use}` } : {}),
            },
          ]}
        />

        {lot === null ? (
          <p className="bc-muted">
            We do not have lot-level provenance for this coffee yet — farm, varietal and
            altitude are still missing. That is a gap in our data, not a gap in the coffee.
          </p>
        ) : null}

        {lot?.farm?.story ? (
          <Explainer>
            <p>{lot.farm.story}</p>
          </Explainer>
        ) : null}
      </section>

      <section className={styles.section} aria-labelledby="what-this-means">
        <h2 id="what-this-means">What that actually means in the cup</h2>
        {coffee.process && processCopy(coffee.process) ? (
          <>
            <h3>{PROCESS_LABEL[coffee.process]} process</h3>
            <p>{processCopy(coffee.process)}</p>
          </>
        ) : null}
        {coffee.roast_level ? (
          <>
            <h3>{ROAST_LEVEL_LABEL[coffee.roast_level]} roast</h3>
            <p>{ROAST_LEVEL_COPY[coffee.roast_level]}</p>
          </>
        ) : null}
        {coffee.intended_use ? (
          <>
            <h3>Brewed as {INTENDED_USE_LABEL[coffee.intended_use].toLowerCase()}</h3>
            <p>{INTENDED_USE_COPY[coffee.intended_use]}</p>
          </>
        ) : null}
      </section>

      <FreshnessSection coffee={coffee} />

      {/*
        Per-viewer, so a client island rather than part of the cached render.

        It works out whether you are signed in ITSELF rather than being told:
        reading a cookie here would force this whole page dynamic, and this is
        the SEO landing page — 300 seconds of shared cache is worth more than
        rendering one sentence server-side.
      */}
      <CoffeeNotes slug={slug} />
      <StartingRecipeCard coffeeProductId={coffee.id} coffeeName={coffee.name} />

      <RecipesSection
        result={recipes}
        heading="Recipes for this coffee"
        headingId="recipes"
        subject="this coffee"
        browseHref={`/recipes?coffee=${coffee.slug}`}
      />

      {equipmentInRecipes.length > 0 ? (
        <section className={styles.section} aria-labelledby="equipment-used">
          <h2 id="equipment-used">Gear people brew it on</h2>
          <ul className={styles.related}>
            {equipmentInRecipes.map((item) => (
              <li key={item.slug}>
                <Link href={`/equipment/${item.slug}`}>{item.name}</Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {otherCoffees.length > 0 ? (
        <section className={styles.section} aria-labelledby="more-from-roaster">
          <h2 id="more-from-roaster">More from {coffee.roaster.name}</h2>
          <ul className="bc-card-grid">
            {otherCoffees.map((item) => (
              <CoffeeCard key={item.id} coffee={item} />
            ))}
          </ul>
          <p>
            <Link href={`/roaster/${coffee.roaster.slug}`}>
              See everything from {coffee.roaster.name} →
            </Link>
          </p>
        </section>
      ) : null}

      <section className={styles.section} aria-labelledby="keep-looking">
        <h2 id="keep-looking">Keep looking</h2>
        <ul className={styles.related}>
          {coffee.origin ? (
            <li>
              <Link href={`/coffee?origin=${encodeURIComponent(coffee.origin.country)}`}>
                More coffees from {coffee.origin.country}
              </Link>
            </li>
          ) : null}
          {coffee.process ? (
            <li>
              <Link href={`/coffee?process=${coffee.process}`}>
                More {PROCESS_LABEL[coffee.process].toLowerCase()} coffees
              </Link>
            </li>
          ) : null}
          <li>
            <Link href="/coffee">Browse the whole catalogue</Link>
          </li>
        </ul>
      </section>
    </div>
  );
}
