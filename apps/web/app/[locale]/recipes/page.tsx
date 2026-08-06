import { type Metadata } from 'next';
import { localeParam, translator } from '../../../lib/locale-server';
import { LocaleLink as Link } from '../../../components/locale-link';
import { Breadcrumbs } from '../../../components/catalog/breadcrumbs';
import {
  loadCoffee,
  loadEquipment,
  loadRecipes,
  type RecipeView,
} from '../../../components/catalog/catalog-api';
import styles from '../../../components/catalog/catalog.module.css';
import { catalogCopy } from '../../../components/catalog/copy';
import { RecipeCard } from '../../../components/catalog/entity-cards';
import { FilterBar, Pagination } from '../../../components/catalog/filter-bar';
import { JsonLd, readCspNonce } from '../../../components/catalog/json-ld';
import { hubMetadata } from '../../../lib/seo';
import { breadcrumbJsonLd, itemListJsonLd } from '../../../lib/structured-data';

/**
 * Recipe hub (REC-06).
 *
 * The API filters recipes by **UUID** (`coffee_product_id`, `brewer_model_id`),
 * which makes for URLs nobody would click and search engines would treat as
 * junk. So the public surface takes **slugs** (`/recipes?coffee=…&brewer=…`)
 * and resolves them to ids server-side, in parallel, from responses that are
 * already cached. `/recipes?brewer=hario-v60-02` is a URL a person can read and
 * a query someone actually types.
 *
 * The whole page degrades to an explanatory panel while the recipes API is
 * still being built.
 */
export const revalidate = 300;

const PAGE_SIZE = 24;
const METHODS = ['filter', 'immersion', 'espresso'] as const;

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function one(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value === '' ? undefined : value;
}

function readFilters(searchParams: Record<string, string | string[] | undefined>) {
  const rawMethod = one(searchParams['method']);
  return {
    coffee: one(searchParams['coffee']),
    brewer: one(searchParams['brewer']),
    method: (METHODS as readonly string[]).includes(rawMethod ?? '') ? rawMethod : undefined,
  };
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const locale = localeParam((await params).locale);
  const copy = catalogCopy(locale);
  const t = translator(locale);
  const search = await searchParams;
  const filters = readFilters(search);
  const methodLabel = filters.method ? (copy.METHOD_LABEL[filters.method] ?? filters.method) : null;

  return hubMetadata({
    title: methodLabel
      ? t('catalog.recipeHub.metaTitleMethod', { method: methodLabel })
      : t('catalog.recipeHub.title'),
    description: t('catalog.recipeHub.metaDescription'),
    basePath: '/recipes',
    filters,
    cursor: one(search['cursor']),
  });
}

export default async function RecipeHubPage({ params, searchParams }: PageProps) {
  const locale = localeParam((await params).locale);
  const copy = catalogCopy(locale);
  const t = translator(locale);
  const search = await searchParams;
  const filters = readFilters(search);
  const cursor = one(search['cursor']);

  // Slug → id, in parallel. A slug that does not resolve simply drops the
  // filter rather than 400ing the recipe query with an empty uuid.
  const [coffeeResult, brewerResult] = await Promise.all([
    filters.coffee ? loadCoffee(filters.coffee) : Promise.resolve({ status: 'missing' } as const),
    filters.brewer
      ? loadEquipment(filters.brewer)
      : Promise.resolve({ status: 'missing' } as const),
  ]);

  const coffee = coffeeResult.status === 'ok' ? coffeeResult.data : null;
  const brewer = brewerResult.status === 'ok' ? brewerResult.data : null;

  const [result, nonce] = await Promise.all([
    loadRecipes({
      coffee_product_id: coffee?.id,
      brewer_model_id: brewer?.id,
      method: filters.method,
      cursor,
      limit: PAGE_SIZE,
    }),
    readCspNonce(),
  ]);

  const recipes: RecipeView[] = result.status === 'ok' ? result.data.items : [];
  const nextCursor = result.status === 'ok' ? result.data.next_cursor : null;
  const hasActiveFilters = Object.values(filters).some((value) => value !== undefined);

  const methodLabel = filters.method ? (copy.METHOD_LABEL[filters.method] ?? filters.method) : null;
  const heading = [
    methodLabel
      ? t('catalog.recipeHub.headingMethod', { method: methodLabel })
      : t('catalog.recipeHub.title'),
    coffee ? t('catalog.recipeHub.headingForCoffee', { coffee: coffee.name }) : null,
    brewer
      ? t('catalog.recipeHub.headingOnBrewer', {
          brewer: `${brewer.brand?.name ?? ''} ${brewer.name}`.replace(/\s+/g, ' ').trim(),
        })
      : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' ');

  const breadcrumbs = [
    { name: t('catalog.crumbs.home'), path: '/' },
    { name: t('catalog.crumbs.recipes'), path: '/recipes' },
  ];

  return (
    <div className="bc-stack">
      <JsonLd
        nonce={nonce}
        documents={[
          breadcrumbJsonLd(breadcrumbs),
          itemListJsonLd(
            heading,
            recipes.map((recipe) => ({ name: recipe.title, path: `/recipes/${recipe.id}` })),
          ),
        ]}
      />

      <Breadcrumbs entries={breadcrumbs} locale={locale} />

      <h1>{heading}</h1>
      <p className="bc-lede">{t('catalog.recipeHub.lede')}</p>

      <FilterBar
        action="/recipes"
        locale={locale}
        legend={t('catalog.filters.recipeLegend')}
        hasActiveFilters={hasActiveFilters}
        selects={[
          {
            name: 'method',
            label: t('catalog.filters.method'),
            anyLabel: t('catalog.filters.anyMethod'),
            selected: filters.method,
            options: METHODS.map((method) => ({
              value: method,
              label: copy.METHOD_LABEL[method] ?? method,
            })),
          },
        ]}
      />

      {filters.coffee && coffee === null ? (
        <p className="bc-muted">{t('catalog.recipeHub.unknownCoffee', { slug: filters.coffee })}</p>
      ) : null}
      {filters.brewer && brewer === null ? (
        <p className="bc-muted">{t('catalog.recipeHub.unknownBrewer', { slug: filters.brewer })}</p>
      ) : null}

      <section aria-labelledby="results">
        <h2 id="results" className="bc-visually-hidden">
          {t('catalog.recipeHub.sectionHeading')}
        </h2>

        {result.status === 'missing' ? (
          <div className={styles.explainer}>
            <p>{t('catalog.recipeHub.notReadyBody')}</p>
            <p>
              {t('catalog.recipeHub.notReadyMeanwhile')}
              <Link href="/coffee">{t('catalog.recipeHub.notReadyCatalogue')}</Link>
              {t('catalog.recipeHub.notReadyAnd')}
              <Link href="/equipment">{t('catalog.recipeHub.notReadyEquipment')}</Link>
              {t('catalog.recipeHub.notReadyTail')}
            </p>
          </div>
        ) : result.status === 'error' ? (
          <p className="bc-muted">{t('catalog.recipeHub.loadError')}</p>
        ) : recipes.length === 0 ? (
          <div className={styles.explainer}>
            <p>{t('catalog.recipeHub.emptyBody')}</p>
            <p>
              {hasActiveFilters ? (
                <Link href="/recipes">{t('catalog.recipeHub.emptyClear')}</Link>
              ) : (
                <Link href="/coffee">{t('catalog.recipeHub.emptyStart')}</Link>
              )}
              .
            </p>
          </div>
        ) : (
          <ul className="bc-card-grid">
            {recipes.map((recipe) => (
              <RecipeCard key={recipe.id} recipe={recipe} locale={locale} />
            ))}
          </ul>
        )}

        <Pagination
          basePath="/recipes"
          locale={locale}
          filters={filters}
          nextCursor={nextCursor}
          itemCount={recipes.length}
          isCursorPage={cursor !== undefined}
        />
      </section>

      <section className={styles.section} aria-labelledby="how-to-read">
        <h2 id="how-to-read">{t('catalog.recipeHub.howToReadHeading')}</h2>
        <p>
          <strong>{t('catalog.recipeHub.howToReadRatio')}</strong>
          {t('catalog.recipeHub.howToReadRatioBody')}
          <strong>{t('catalog.recipeHub.howToReadGrind')}</strong>
          {t('catalog.recipeHub.howToReadGrindBody')}
        </p>
        <p className="bc-muted">{t('catalog.recipeHub.howToReadNote')}</p>
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
            <Link href="/equipment">{t('catalog.elsewhere.equipment')}</Link>
          </li>
        </ul>
      </section>
    </div>
  );
}
