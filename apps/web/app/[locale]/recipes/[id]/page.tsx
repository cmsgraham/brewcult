import { type Metadata } from 'next';
import { localeParam } from '../../../../lib/locale-server';
import { LocaleLink as Link } from '../../../../components/locale-link';
import { Breadcrumbs } from '../../../../components/catalog/breadcrumbs';
import { loadRecipe, type RecipeView } from '../../../../components/catalog/catalog-api';
import styles from '../../../../components/catalog/catalog.module.css';
import { catalogCopy, duration, grindCategoryLabel } from '../../../../components/catalog/copy';
import { authorName } from '../../../../components/catalog/entity-cards';
import { JsonLd, readCspNonce } from '../../../../components/catalog/json-ld';
import {
  RecipeGrind,
  RecipeLineage,
  RecipeParams,
  RecipePours,
  RecipePuckPrep,
  isEspresso,
  isFilter,
  ratioText,
  recipeSummaryLine,
} from '../../../../components/catalog/recipe-body';
import { Explainer } from '../../../../components/catalog/spec-list';
import { notFoundMetadata, recipeMetadata } from '../../../../lib/seo';
import { breadcrumbJsonLd, recipeJsonLd } from '../../../../lib/structured-data';

/**
 * Recipe detail (REC-06) — "best V60 recipe for [coffee]".
 *
 * Two things this page must never do:
 *
 *  1. **Present itself as the answer.** §10.2 (autonomy) and §9.7
 *     (anti-gatekeeping) both point the same way: a recipe is one person's
 *     starting point on their gear with their water. That framing is above the
 *     fold, not in a footnote.
 *  2. **Print a bare grind number.** §6.4. The coarse category leads; the dial
 *     setting is always attributed to a specific grinder.
 *
 * The recipes API (Lane H) may not exist yet. Rather than 404, a missing
 * endpoint renders an explicit "not switched on yet" page — a 404 would tell
 * someone following a shared link that their link is broken, which is false.
 */
export const revalidate = 300;

interface PageProps {
  params: Promise<{ id: string; locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const locale = localeParam((await params).locale);
  const copy = catalogCopy(locale);
  const { id } = await params;
  const result = await loadRecipe(id);
  if (result.status !== 'ok') return notFoundMetadata('Recipe');

  const recipe = result.data;
  return recipeMetadata({
    id: recipe.id,
    title: recipe.title,
    methodLabel: copy.METHOD_LABEL[recipe.method] ?? recipe.method,
    brewerName: recipe.brewer?.name ?? null,
    coffeeName: recipe.coffee?.name ?? null,
    authorName: authorName(recipe.author),
  });
}

/** schema.org `recipeIngredient` lines, built only from recorded numbers. */
function ingredientLines(recipe: RecipeView): string[] {
  const params = recipe.params;
  if (params === null) return [];
  const lines: string[] = [];

  if (isFilter(params)) {
    lines.push(`${params.dose_g} g coffee`);
    lines.push(`${params.water_g} g water`);
    if (typeof params.temperature_c === 'number') {
      lines.push(`Water at ${params.temperature_c} °C`);
    }
    if (params.filter_type) lines.push(`${params.filter_type} filter`);
  } else if (isEspresso(params)) {
    lines.push(`${params.dose_in_g} g coffee`);
    lines.push(`${params.yield_out_g} g espresso out`);
    if (typeof params.temperature_c === 'number') {
      lines.push(`Brew temperature ${params.temperature_c} °C`);
    }
  }

  const category = grindCategoryLabel(recipe.grind?.category);
  if (category) lines.push(`Ground ${category.toLowerCase()}`);
  return lines;
}

/** `recipeInstructions` — the pour schedule when there is one, otherwise the
 *  single honest step the recipe actually describes. */
function instructionSteps(recipe: RecipeView): { name?: string | null; text: string }[] {
  const params = recipe.params;
  if (isFilter(params) && params.pours && params.pours.length > 0) {
    return params.pours.map((pour, index) => ({
      name: index === 0 ? 'Bloom' : `Pour ${index + 1}`,
      text: `At ${duration(pour.at_s) ?? `${pour.at_s}s`}, pour up to ${pour.to_g} g total.${
        pour.note ? ` ${pour.note}` : ''
      }`,
    }));
  }
  if (isEspresso(params)) {
    return [
      {
        name: 'Pull the shot',
        text: `Dose ${params.dose_in_g} g, target ${params.yield_out_g} g out${
          typeof params.shot_time_s === 'number' ? ` in about ${params.shot_time_s} seconds` : ''
        }.`,
      },
    ];
  }
  if (isFilter(params)) {
    return [
      {
        name: 'Brew',
        text: `Brew ${params.dose_g} g of coffee with ${params.water_g} g of water${
          typeof params.brew_time_s === 'number'
            ? `, aiming for a total time of about ${duration(params.brew_time_s)}`
            : ''
        }.`,
      },
    ];
  }
  return [];
}

function yieldText(recipe: RecipeView): string | null {
  const params = recipe.params;
  if (isEspresso(params)) return `${params.yield_out_g} g espresso`;
  if (isFilter(params)) return `${params.water_g} g brewed coffee`;
  return null;
}

function totalSeconds(recipe: RecipeView): number | null {
  const params = recipe.params;
  if (isEspresso(params)) return params.shot_time_s ?? null;
  if (isFilter(params)) return params.brew_time_s ?? null;
  return null;
}

export default async function RecipeDetailPage({ params }: PageProps) {
  const locale = localeParam((await params).locale);
  const copy = catalogCopy(locale);
  const { id } = await params;
  const [result, nonce] = await Promise.all([loadRecipe(id), readCspNonce()]);

  if (result.status !== 'ok') {
    // Deliberately not `notFound()` — see the header comment. Both states are
    // noindex via `generateMetadata`, so neither can be indexed as thin content.
    return (
      <div className="bc-stack">
        <h1>{result.status === 'missing' ? 'Recipes are not switched on yet' : 'We could not load this recipe'}</h1>
        <p className="bc-lede">
          {result.status === 'missing'
            ? 'Recipe pages are being built right now. If someone shared this link with you, it will start working shortly — the link itself is fine.'
            : 'That is on us, not on you. Try again in a moment.'}
        </p>
        <ul className={styles.related}>
          <li>
            <Link href="/recipes">All recipes</Link>
          </li>
          <li>
            <Link href="/coffee">Browse coffees</Link>
          </li>
          <li>
            <Link href="/equipment">Browse equipment</Link>
          </li>
        </ul>
      </div>
    );
  }

  const recipe = result.data;
  const method = copy.METHOD_LABEL[recipe.method] ?? recipe.method;
  const author = authorName(recipe.author);
  const total = totalSeconds(recipe);

  const breadcrumbs = [
    { name: 'Home', path: '/' },
    { name: 'Recipes', path: '/recipes' },
    { name: recipe.title, path: `/recipes/${recipe.id}` },
  ];

  return (
    <div className="bc-stack">
      <JsonLd
        nonce={nonce}
        documents={[
          recipeJsonLd({
            id: recipe.id,
            name: recipe.title,
            description: recipeSummaryLine(recipe),
            authorName: author,
            datePublished: recipe.created_at,
            method,
            ingredients: ingredientLines(recipe),
            steps: instructionSteps(recipe),
            totalTimeSeconds: total,
            yieldText: yieldText(recipe),
            tools: [recipe.brewer?.name, recipe.grinder?.name].filter(
              (name): name is string => Boolean(name),
            ),
            keywords: [method, recipe.coffee?.name, recipe.brewer?.name].filter(
              (word): word is string => Boolean(word),
            ),
          }),
          breadcrumbJsonLd(breadcrumbs),
        ]}
      />

      <Breadcrumbs entries={breadcrumbs} />

      <header className={styles.header}>
        <p className={styles.eyebrow}>{method} recipe</p>
        <h1>{recipe.title}</h1>
        <p className={styles.byline}>
          {recipe.is_official ? 'Published by the roaster' : author ? `By ${author}` : 'By a community member'}
          {recipe.coffee ? (
            <>
              {' · for '}
              {recipe.coffee.slug ? (
                <Link href={`/coffee/${recipe.coffee.slug}`}>{recipe.coffee.name}</Link>
              ) : (
                recipe.coffee.name
              )}
            </>
          ) : null}
          {recipe.brewer ? (
            <>
              {' · on the '}
              <Link href={`/equipment/${recipe.brewer.slug}`}>{recipe.brewer.name}</Link>
            </>
          ) : null}
        </p>

        <Explainer>
          <p>
            <strong>This is a starting point, not a rule.</strong> {copy.RECIPE_STARTING_POINT_COPY}
          </p>
        </Explainer>

        <RecipeLineage recipe={recipe} />
      </header>

      <section aria-labelledby="parameters">
        <h2 id="parameters">The numbers</h2>
        <RecipeParams recipe={recipe} />
        {ratioText(recipe.params) ? (
          <p className="bc-muted">
            The ratio is the part worth keeping when you scale up or down — the absolute
            numbers matter less than their relationship.
          </p>
        ) : null}
      </section>

      <section className={styles.section} aria-labelledby="grind">
        <h2 id="grind">Grind</h2>
        <RecipeGrind recipe={recipe} />
        {recipe.grinder ? (
          <p>
            <Link href={`/equipment/${recipe.grinder.slug}`}>
              See grind conversions for the {recipe.grinder.name} →
            </Link>
          </p>
        ) : null}
      </section>

      {isFilter(recipe.params) && recipe.params.pours && recipe.params.pours.length > 0 ? (
        <section className={styles.section} aria-labelledby="pours">
          <h2 id="pours">Pour schedule</h2>
          <p className="bc-muted">
            Times are from the moment water first hits the coffee. Weights are cumulative — the
            number on the scale, not the amount for that pour.
          </p>
          <RecipePours recipe={recipe} />
        </section>
      ) : null}

      {isEspresso(recipe.params) && recipe.params.puck_prep?.length ? (
        <section className={styles.section} aria-labelledby="puck-prep">
          <h2 id="puck-prep">Puck preparation</h2>
          <RecipePuckPrep recipe={recipe} />
        </section>
      ) : null}

      <section className={styles.section} aria-labelledby="if-it-tastes-off">
        <h2 id="if-it-tastes-off">If it does not taste right</h2>
        <p>
          Change one thing at a time — that is the whole technique. If it is sour, thin or
          weak, the coffee is probably under-extracted: grind finer, or use hotter water, or
          give it longer. If it is bitter, harsh or drying, it is probably over-extracted:
          grind coarser, or cool the water slightly, or cut the brew short.
        </p>
        <p className="bc-muted">
          A cup that misses on the first go is the normal outcome, not a verdict on your gear
          or on you.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="keep-looking">
        <h2 id="keep-looking">Keep looking</h2>
        <ul className={styles.related}>
          {recipe.coffee?.slug ? (
            <li>
              <Link href={`/coffee/${recipe.coffee.slug}`}>About {recipe.coffee.name}</Link>
            </li>
          ) : null}
          {recipe.brewer ? (
            <li>
              <Link href={`/recipes?brewer=${recipe.brewer.slug}`}>
                More {recipe.brewer.name} recipes
              </Link>
            </li>
          ) : null}
          <li>
            <Link href={`/recipes?method=${recipe.method}`}>More {method.toLowerCase()} recipes</Link>
          </li>
          <li>
            <Link href="/recipes">All recipes</Link>
          </li>
        </ul>
      </section>
    </div>
  );
}
