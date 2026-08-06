import { type Metadata } from 'next';
import { localeParam } from '../../../lib/locale-server';
import Link from 'next/link';
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
  const search = await searchParams;
  const filters = readFilters(search);
  const methodLabel = filters.method ? (copy.METHOD_LABEL[filters.method] ?? filters.method) : null;

  return hubMetadata({
    title: methodLabel ? `${methodLabel} brewing recipes` : 'Brewing recipes',
    description:
      'Community and roaster brewing recipes with dose, water, ratio, temperature, grind and full pour schedules — each one a starting point to dial in from, not a rule.',
    basePath: '/recipes',
    filters,
    cursor: one(search['cursor']),
  });
}

export default async function RecipeHubPage({ params, searchParams }: PageProps) {
  const locale = localeParam((await params).locale);
  const copy = catalogCopy(locale);
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
    methodLabel ? `${methodLabel} recipes` : 'Brewing recipes',
    coffee ? `for ${coffee.name}` : null,
    brewer ? `on the ${brewer.brand?.name ?? ''} ${brewer.name}`.replace(/\s+/g, ' ') : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' ');

  const breadcrumbs = [
    { name: 'Home', path: '/' },
    { name: 'Recipes', path: '/recipes' },
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

      <Breadcrumbs entries={breadcrumbs} />

      <h1>{heading}</h1>
      <p className="bc-lede">
        Every recipe here carries its dose, water, ratio, temperature and grind — and a coarse
        grind category, because a dial number from someone else&rsquo;s grinder does not
        transfer to yours. Take one as a starting point and change one thing at a time.
      </p>

      <FilterBar
        action="/recipes"
        legend="Filter recipes"
        hasActiveFilters={hasActiveFilters}
        selects={[
          {
            name: 'method',
            label: 'Method',
            anyLabel: 'Any method',
            selected: filters.method,
            options: METHODS.map((method) => ({
              value: method,
              label: copy.METHOD_LABEL[method] ?? method,
            })),
          },
        ]}
      />

      {filters.coffee && coffee === null ? (
        <p className="bc-muted">
          We could not find a coffee with the slug &ldquo;{filters.coffee}&rdquo;, so that
          filter was ignored.
        </p>
      ) : null}
      {filters.brewer && brewer === null ? (
        <p className="bc-muted">
          We could not find equipment with the slug &ldquo;{filters.brewer}&rdquo;, so that
          filter was ignored.
        </p>
      ) : null}

      <section aria-labelledby="results">
        <h2 id="results" className="bc-visually-hidden">
          Recipes
        </h2>

        {result.status === 'missing' ? (
          <div className={styles.explainer}>
            <p>
              Recipes are not switched on yet — the brewing API is being built right now.
              When it lands, this page fills up with community and roaster recipes, each one
              linked to the coffee and the gear it was written on.
            </p>
            <p>
              In the meantime,{' '}
              <Link href="/coffee">the coffee catalogue</Link> and{' '}
              <Link href="/equipment">the equipment pages</Link> are live — including
              community grind conversions for grinders.
            </p>
          </div>
        ) : result.status === 'error' ? (
          <p className="bc-muted">
            We could not load recipes just now — that is on us, not on you. Try again in a
            moment.
          </p>
        ) : recipes.length === 0 ? (
          <div className={styles.explainer}>
            <p>
              No recipes match that yet. Empty is a real answer here — we would rather show you
              nothing than pad the page with recipes for a different coffee.
            </p>
            <p>
              {hasActiveFilters ? (
                <Link href="/recipes">Clear the filters</Link>
              ) : (
                <Link href="/coffee">Start from a coffee instead</Link>
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
          filters={filters}
          nextCursor={nextCursor}
          itemCount={recipes.length}
          isCursorPage={cursor !== undefined}
        />
      </section>

      <section className={styles.section} aria-labelledby="how-to-read">
        <h2 id="how-to-read">How to read a recipe here</h2>
        <p>
          <strong>Ratio</strong> is the part that travels — 1:16 means one gram of coffee to
          sixteen of water, whatever size you brew. <strong>Grind category</strong> (fine,
          medium-fine, medium…) is the only grind information that survives a change of
          grinder; a dial number is always shown attached to the grinder it came from.
        </p>
        <p className="bc-muted">
          Nobody&rsquo;s first attempt at someone else&rsquo;s recipe tastes the same as
          theirs. That is water, beans and burrs, not you.
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
            <Link href="/equipment">Brewers and grinders</Link>
          </li>
        </ul>
      </section>
    </div>
  );
}
