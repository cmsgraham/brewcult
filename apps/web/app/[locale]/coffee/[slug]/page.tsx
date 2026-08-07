import { type Metadata } from 'next';
import { LocaleLink as Link } from '../../../../components/locale-link';
import { notFound } from 'next/navigation';
import { Breadcrumbs } from '../../../../components/catalog/breadcrumbs';
import {
  loadCoffee,
  loadCoffees,
  loadRecipes,
  type CoffeeDetail,
} from '../../../../components/catalog/catalog-api';
import { CoffeeCard } from '../../../../components/catalog/entity-cards';
import styles from '../../../../components/catalog/catalog.module.css';
import {
  catalogCopy,
  originLabel,
  processCopyFor,
} from '../../../../components/catalog/copy';
import { CoffeeNotes } from '../../../../components/coffee/coffee-notes';
import { CoffeeOffers } from '../../../../components/coffee/coffee-offers';
import { EntityImage } from '../../../../components/media/entity-image';
import { FreshnessSection } from '../../../../components/catalog/freshness';
import { StartingRecipeCard } from '../../../../components/ai/starting-recipe';
import { JsonLd, readCspNonce } from '../../../../components/catalog/json-ld';
import { RecipesSection } from '../../../../components/catalog/recipes-section';
import { Explainer, SpecList, TagList } from '../../../../components/catalog/spec-list';
import { coffeeMetadata, localeAlternates, notFoundMetadata, sentence } from '../../../../lib/seo';
import { localeParam, translator } from '../../../../lib/locale-server';
import type { Translator } from '../../../../lib/i18n';
import { breadcrumbJsonLd, coffeeProductJsonLd } from '../../../../lib/structured-data';

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
  params: Promise<{ slug: string; locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, locale: rawLocale } = await params;
  const locale = localeParam(rawLocale);
  const t = translator(locale);
  const result = await loadCoffee(slug);
  if (result.status !== 'ok') return notFoundMetadata(t('coffeePage.notFound'));

  const coffee = result.data;
  const copy = catalogCopy(locale);
  return {
    ...coffeeMetadata({
      slug: coffee.slug,
      name: coffee.name,
      roasterName: coffee.roaster?.name ?? t('coffeePage.anIndependentRoaster'),
      originLabel: originLabel(coffee.origin),
      processLabel: coffee.process ? copy.PROCESS_LABEL[coffee.process] : null,
      roastLevelLabel: coffee.roast_level ? copy.ROAST_LEVEL_LABEL[coffee.roast_level] : null,
      tastingNotes: coffee.tasting_notes ?? [],
    }),
    // hreflang for the coffee that IS this coffee in the other language —
    // the slug is language-independent because it comes from the bag.
    alternates: localeAlternates(`/coffee/${slug}`, locale),
  };
}

/**
 * Lede sentence — assembled from real data so no two pages read identically.
 *
 * The fragments are separate catalogue entries rather than one template because
 * each is independently optional: a coffee with no known origin, or no roaster,
 * or no tasting notes still has to produce a sentence. The adjective also lands
 * on the other side of the noun in Spanish ("un cafe lavado de Etiopia"), which
 * is why `{process}` carries its own trailing space in the English string and
 * none in the Spanish one rather than being glued on here.
 */
function ledeFor(coffee: CoffeeDetail, locale: string, t: Translator): string {
  const copy = catalogCopy(locale);
  const where = originLabel(coffee.origin);
  const process = coffee.process ? copy.PROCESS_LABEL[coffee.process].toLowerCase() : null;
  const notes = coffee.tasting_notes?.length
    ? t('coffeePage.ledeNotes', { notes: coffee.tasting_notes.join(', ') })
    : null;

  return sentence(
    where
      ? t('coffeePage.ledeFrom', { process: process ? `${process} ` : '', origin: where })
      : t('coffeePage.ledePlain'),
    coffee.roaster ? t('coffeePage.ledeRoaster', { roaster: coffee.roaster.name }) : '.',
    notes,
  );
}

export default async function CoffeeDetailPage({ params }: PageProps) {
  const { slug, locale: rawLocale } = await params;
  const locale = localeParam(rawLocale);
  const copy = catalogCopy(locale);
  const t = translator(locale);
  const result = await loadCoffee(slug);

  // A hard 404 for a slug that does not exist; a soft error page would be
  // indexed, which is worse than being absent.
  if (result.status === 'missing') notFound();
  if (result.status === 'error') {
    return (
      <div className="bc-stack">
        <h1>{t('coffeePage.loadErrorTitle')}</h1>
        <p className="bc-lede">
          {t('coffeePage.loadErrorBody')}{' '}
          <Link href="/coffee">{t('coffeePage.browseRest')}</Link>.
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
    { name: t('coffeePage.breadcrumbHome'), path: '/' },
    { name: t('coffeePage.breadcrumbCoffee'), path: '/coffee' },
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
            description: ledeFor(coffee, locale, t),
            roaster: { name: coffee.roaster.name, slug: coffee.roaster.slug },
            roastLevel: coffee.roast_level ? copy.ROAST_LEVEL_LABEL[coffee.roast_level] : null,
            intendedUse: coffee.intended_use ? copy.INTENDED_USE_LABEL[coffee.intended_use] : null,
            tastingNotes: coffee.tasting_notes ?? [],
            process: coffee.process ? copy.PROCESS_LABEL[coffee.process] : null,
            varietals: lot?.varietals ?? [],
            altitudeMasl: lot?.altitude_masl ?? null,
            harvestPeriod: lot?.harvest_period ?? null,
            origin: coffee.origin ?? null,
            farmName: lot?.farm?.name ?? null,
          }),
          breadcrumbJsonLd(breadcrumbs),
        ]}
      />

      <Breadcrumbs entries={breadcrumbs} locale={locale} />


      {/* The bag. Usually photographed by whoever added the coffee — for a lot
          that exists for six weeks, that is the only picture there will ever
          be. `EntityImage` renders nothing at all when there is none, rather
          than a grey placeholder pretending to be one. */}
      <EntityImage
        entity={coffee}
        alt={`${coffee.roaster?.name ?? ''} ${coffee.name}`.trim()}
        shape="hero"
      />
      <header className={styles.header}>
        <p className={styles.eyebrow}>{t('coffeePage.eyebrow')}</p>
        <h1>{coffee.name}</h1>
        {coffee.roaster ? (
          <p className={styles.byline}>
            {t('coffeePage.roastedBy')}{' '}
            <Link href={`/roaster/${coffee.roaster.slug}`}>{coffee.roaster.name}</Link>
          </p>
        ) : null}
        <p className="bc-lede">{ledeFor(coffee, locale, t)}</p>
        {coffee.status !== 'active' ? (
          <p className="bc-muted">{copy.STATUS_COPY[coffee.status]}</p>
        ) : null}
      </header>

      {coffee.tasting_notes?.length ? (
        <section aria-labelledby="tasting-notes">
          <h2 id="tasting-notes">{t('coffeePage.tastingNotes')}</h2>
          <TagList items={coffee.tasting_notes} label={t('coffeePage.tastingNotes')} />
          <p className="bc-muted">{t('coffeePage.tastingNotesCaveat')}</p>
        </section>
      ) : null}

      <section className={styles.section} aria-labelledby="provenance">
        <h2 id="provenance">{t('coffeePage.provenance')}</h2>
        <SpecList
          rows={[
            {
              label: t('coffeePage.origin'),
              value: origin,
              ...(coffee.origin ? { href: `/coffee?origin=${encodeURIComponent(coffee.origin.country)}` } : {}),
            },
            { label: t('coffeePage.farm'), value: lot?.farm?.name ?? null },
            {
              label: t('coffeePage.process'),
              value: coffee.process ? copy.PROCESS_LABEL[coffee.process] : null,
              ...(coffee.process ? { href: `/coffee?process=${coffee.process}` } : {}),
            },
            { label: t('coffeePage.processDetail'), value: lot?.process_detail ?? null },
            {
              label: t('coffeePage.varietals'),
              value: lot?.varietals?.length ? lot.varietals.join(', ') : null,
            },
            {
              label: t('coffeePage.altitude'),
              value: lot?.altitude_masl
                ? t('coffeePage.masl', { value: lot.altitude_masl })
                : null,
            },
            { label: t('coffeePage.harvest'), value: lot?.harvest_period ?? null },
            {
              label: t('coffeePage.roastLevel'),
              value: coffee.roast_level ? copy.ROAST_LEVEL_LABEL[coffee.roast_level] : null,
              ...(coffee.roast_level ? { href: `/coffee?roast_level=${coffee.roast_level}` } : {}),
            },
            {
              label: t('coffeePage.bestFor'),
              value: coffee.intended_use ? copy.INTENDED_USE_LABEL[coffee.intended_use] : null,
              ...(coffee.intended_use ? { href: `/coffee?intended_use=${coffee.intended_use}` } : {}),
            },
          ]}
        />

        {lot === null ? (
          <p className="bc-muted">{t('coffeePage.noLot')}</p>
        ) : null}

        {lot?.farm?.story ? (
          <Explainer>
            <p>{lot.farm.story}</p>
          </Explainer>
        ) : null}
      </section>

      <section className={styles.section} aria-labelledby="what-this-means">
        <h2 id="what-this-means">{t('coffeePage.whatItMeans')}</h2>
        {coffee.process && processCopyFor(coffee.process, locale) ? (
          <>
            <h3>{t('coffeePage.processHeading', { process: copy.PROCESS_LABEL[coffee.process] })}</h3>
            <p>{processCopyFor(coffee.process, locale)}</p>
          </>
        ) : null}
        {coffee.roast_level ? (
          <>
            <h3>{t('coffeePage.roastHeading', { roast: copy.ROAST_LEVEL_LABEL[coffee.roast_level] })}</h3>
            <p>{copy.ROAST_LEVEL_COPY[coffee.roast_level]}</p>
          </>
        ) : null}
        {coffee.intended_use ? (
          <>
            <h3>
              {t('coffeePage.brewedAs', {
                use: copy.INTENDED_USE_LABEL[coffee.intended_use].toLowerCase(),
              })}
            </h3>
            <p>{copy.INTENDED_USE_COPY[coffee.intended_use]}</p>
          </>
        ) : null}
      </section>

      <FreshnessSection coffee={coffee} locale={locale} />

      {/*
        Per-viewer, so a client island rather than part of the cached render.

        It works out whether you are signed in ITSELF rather than being told:
        reading a cookie here would force this whole page dynamic, and this is
        the SEO landing page — 300 seconds of shared cache is worth more than
        rendering one sentence server-side.
      */}
      {/* Prices before opinions: somebody who has decided they want this coffee
          is looking for where to get it, and that answer should not be below a
          page of tasting notes. */}
      <CoffeeOffers slug={slug} />

      <CoffeeNotes slug={slug} />
      <StartingRecipeCard coffeeProductId={coffee.id} coffeeName={coffee.name} />

      <RecipesSection
        result={recipes}
        locale={locale}
        heading={t('coffeePage.recipesHeading')}
        headingId="recipes"
        subject={t('coffeePage.recipesSubject')}
        browseHref={`/recipes?coffee=${coffee.slug}`}
      />

      {equipmentInRecipes.length > 0 ? (
        <section className={styles.section} aria-labelledby="equipment-used">
          <h2 id="equipment-used">{t('coffeePage.gearHeading')}</h2>
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
          <h2 id="more-from-roaster">
            {t('coffeePage.moreFrom', { roaster: coffee.roaster.name })}
          </h2>
          <ul className="bc-card-grid">
            {otherCoffees.map((item) => (
              <CoffeeCard key={item.id} coffee={item} locale={locale} />
            ))}
          </ul>
          <p>
            <Link href={`/roaster/${coffee.roaster.slug}`}>
              {t('coffeePage.seeEverything', { roaster: coffee.roaster.name })}
            </Link>
          </p>
        </section>
      ) : null}

      <section className={styles.section} aria-labelledby="keep-looking">
        <h2 id="keep-looking">{t('coffeePage.keepLooking')}</h2>
        <ul className={styles.related}>
          {coffee.origin ? (
            <li>
              <Link href={`/coffee?origin=${encodeURIComponent(coffee.origin.country)}`}>
                {t('coffeePage.moreFromOrigin', { country: coffee.origin.country })}
              </Link>
            </li>
          ) : null}
          {coffee.process ? (
            <li>
              <Link href={`/coffee?process=${coffee.process}`}>
                {t('coffeePage.moreProcess', {
                  process: copy.PROCESS_LABEL[coffee.process].toLowerCase(),
                })}
              </Link>
            </li>
          ) : null}
          <li>
            <Link href="/coffee">{t('coffeePage.browseWhole')}</Link>
          </li>
        </ul>
      </section>
    </div>
  );
}
