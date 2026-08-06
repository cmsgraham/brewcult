import { type Metadata } from 'next';
import { localeParam, translator } from '../../../../lib/locale-server';
import type { Locale, Translator } from '../../../../lib/i18n';
import { LocaleLink as Link } from '../../../../components/locale-link';
import { Breadcrumbs } from '../../../../components/catalog/breadcrumbs';
import { loadRecipe, type RecipeView } from '../../../../components/catalog/catalog-api';
import styles from '../../../../components/catalog/catalog.module.css';
import { catalogCopy, duration, grindCategoryInline } from '../../../../components/catalog/copy';
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
  const t = translator(locale);
  const { id } = await params;
  const result = await loadRecipe(id);
  if (result.status !== 'ok') return notFoundMetadata(t('catalog.crumbs.recipes'));

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

/**
 * schema.org `recipeIngredient` lines, built only from recorded numbers.
 *
 * These are translated for the same reason the visible copy is: structured data
 * in English on a Spanish page tells a search engine something the page does
 * not say, and it is what gets lifted into a rich result.
 */
function ingredientLines(recipe: RecipeView, locale: Locale, t: Translator): string[] {
  const params = recipe.params;
  if (params === null) return [];
  const lines: string[] = [];

  if (isFilter(params)) {
    lines.push(t('catalog.recipeJsonLd.coffeeGrams', { grams: params.dose_g }));
    lines.push(t('catalog.recipeJsonLd.waterGrams', { grams: params.water_g }));
    if (typeof params.temperature_c === 'number') {
      lines.push(t('catalog.recipeJsonLd.waterAt', { temp: params.temperature_c }));
    }
    if (params.filter_type) {
      lines.push(t('catalog.recipeJsonLd.filterType', { type: params.filter_type }));
    }
  } else if (isEspresso(params)) {
    lines.push(t('catalog.recipeJsonLd.coffeeGrams', { grams: params.dose_in_g }));
    lines.push(t('catalog.recipeJsonLd.espressoOut', { grams: params.yield_out_g }));
    if (typeof params.temperature_c === 'number') {
      lines.push(t('catalog.recipeJsonLd.brewTemperature', { temp: params.temperature_c }));
    }
  }

  const category = grindCategoryInline(recipe.grind?.category, locale);
  if (category) lines.push(t('catalog.recipeJsonLd.groundAs', { category }));
  return lines;
}

/** `recipeInstructions` — the pour schedule when there is one, otherwise the
 *  single honest step the recipe actually describes. */
function instructionSteps(
  recipe: RecipeView,
  t: Translator,
): { name?: string | null; text: string }[] {
  const params = recipe.params;
  if (isFilter(params) && params.pours && params.pours.length > 0) {
    return params.pours.map((pour, index) => ({
      name:
        index === 0
          ? t('catalog.recipeJsonLd.bloom')
          : t('catalog.recipeJsonLd.pourN', { n: index + 1 }),
      text:
        t('catalog.recipeJsonLd.pourStep', {
          at: duration(pour.at_s) ?? `${pour.at_s}s`,
          to: pour.to_g,
        }) + (pour.note ? ` ${pour.note}` : ''),
    }));
  }
  if (isEspresso(params)) {
    return [
      {
        name: t('catalog.recipeJsonLd.pullShot'),
        text:
          typeof params.shot_time_s === 'number'
            ? t('catalog.recipeJsonLd.pullShotStepTimed', {
                dose: params.dose_in_g,
                yield: params.yield_out_g,
                seconds: params.shot_time_s,
              })
            : t('catalog.recipeJsonLd.pullShotStep', {
                dose: params.dose_in_g,
                yield: params.yield_out_g,
              }),
      },
    ];
  }
  if (isFilter(params)) {
    return [
      {
        name: t('catalog.recipeJsonLd.brew'),
        text:
          typeof params.brew_time_s === 'number'
            ? t('catalog.recipeJsonLd.brewStepTimed', {
                dose: params.dose_g,
                water: params.water_g,
                time: duration(params.brew_time_s) ?? `${params.brew_time_s}s`,
              })
            : t('catalog.recipeJsonLd.brewStep', {
                dose: params.dose_g,
                water: params.water_g,
              }),
      },
    ];
  }
  return [];
}

function yieldText(recipe: RecipeView, t: Translator): string | null {
  const params = recipe.params;
  if (isEspresso(params)) {
    return t('catalog.recipeJsonLd.yieldEspresso', { grams: params.yield_out_g });
  }
  if (isFilter(params)) {
    return t('catalog.recipeJsonLd.yieldFilter', { grams: params.water_g });
  }
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
  const t = translator(locale);
  const { id } = await params;
  const [result, nonce] = await Promise.all([loadRecipe(id), readCspNonce()]);

  if (result.status !== 'ok') {
    // Deliberately not `notFound()` — see the header comment. Both states are
    // noindex via `generateMetadata`, so neither can be indexed as thin content.
    return (
      <div className="bc-stack">
        <h1>
          {result.status === 'missing'
            ? t('catalog.recipeDetail.notReadyTitle')
            : t('catalog.recipeDetail.loadErrorTitle')}
        </h1>
        <p className="bc-lede">
          {result.status === 'missing'
            ? t('catalog.recipeDetail.notReadyBody')
            : t('catalog.recipeDetail.loadErrorBody')}
        </p>
        <ul className={styles.related}>
          <li>
            <Link href="/recipes">{t('catalog.recipeDetail.allRecipes')}</Link>
          </li>
          <li>
            <Link href="/coffee">{t('catalog.recipeDetail.browseCoffees')}</Link>
          </li>
          <li>
            <Link href="/equipment">{t('catalog.recipeDetail.browseEquipment')}</Link>
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
    { name: t('catalog.crumbs.home'), path: '/' },
    { name: t('catalog.crumbs.recipes'), path: '/recipes' },
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
            description: recipeSummaryLine(recipe, locale),
            authorName: author,
            datePublished: recipe.created_at,
            method,
            ingredients: ingredientLines(recipe, locale, t),
            steps: instructionSteps(recipe, t),
            totalTimeSeconds: total,
            yieldText: yieldText(recipe, t),
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

      <Breadcrumbs entries={breadcrumbs} locale={locale} />

      <header className={styles.header}>
        <p className={styles.eyebrow}>{t('catalog.recipeDetail.eyebrow', { method })}</p>
        <h1>{recipe.title}</h1>
        <p className={styles.byline}>
          {recipe.is_official
            ? t('catalog.recipeDetail.byRoaster')
            : author
              ? t('catalog.recipeDetail.byAuthor', { author })
              : t('catalog.recipeDetail.byCommunity')}
          {recipe.coffee ? (
            <>
              {t('catalog.recipeDetail.forCoffee')}
              {recipe.coffee.slug ? (
                <Link href={`/coffee/${recipe.coffee.slug}`}>{recipe.coffee.name}</Link>
              ) : (
                recipe.coffee.name
              )}
            </>
          ) : null}
          {recipe.brewer ? (
            <>
              {t('catalog.recipeDetail.onBrewer')}
              <Link href={`/equipment/${recipe.brewer.slug}`}>{recipe.brewer.name}</Link>
            </>
          ) : null}
        </p>

        <Explainer>
          <p>
            <strong>{t('catalog.recipeDetail.startingPoint')}</strong>{' '}
            {copy.RECIPE_STARTING_POINT_COPY}
          </p>
        </Explainer>

        <RecipeLineage recipe={recipe} locale={locale} />
      </header>

      <section aria-labelledby="parameters">
        <h2 id="parameters">{t('catalog.recipeDetail.numbersHeading')}</h2>
        <RecipeParams recipe={recipe} locale={locale} />
        {ratioText(recipe.params) ? (
          <p className="bc-muted">{t('catalog.recipeDetail.ratioNote')}</p>
        ) : null}
      </section>

      <section className={styles.section} aria-labelledby="grind">
        <h2 id="grind">{t('catalog.recipeDetail.grindHeading')}</h2>
        <RecipeGrind recipe={recipe} locale={locale} />
        {recipe.grinder ? (
          <p>
            <Link href={`/equipment/${recipe.grinder.slug}`}>
              {t('catalog.recipeDetail.grindConversionsLink', { name: recipe.grinder.name })}
            </Link>
          </p>
        ) : null}
      </section>

      {isFilter(recipe.params) && recipe.params.pours && recipe.params.pours.length > 0 ? (
        <section className={styles.section} aria-labelledby="pours">
          <h2 id="pours">{t('catalog.recipeDetail.poursHeading')}</h2>
          <p className="bc-muted">{t('catalog.recipeDetail.poursNote')}</p>
          <RecipePours recipe={recipe} locale={locale} />
        </section>
      ) : null}

      {isEspresso(recipe.params) && recipe.params.puck_prep?.length ? (
        <section className={styles.section} aria-labelledby="puck-prep">
          <h2 id="puck-prep">{t('catalog.recipeDetail.puckPrepHeading')}</h2>
          <RecipePuckPrep recipe={recipe} locale={locale} />
        </section>
      ) : null}

      <section className={styles.section} aria-labelledby="if-it-tastes-off">
        <h2 id="if-it-tastes-off">{t('catalog.recipeDetail.tastesOffHeading')}</h2>
        <p>{t('catalog.recipeDetail.tastesOffBody')}</p>
        <p className="bc-muted">{t('catalog.recipeDetail.tastesOffNote')}</p>
      </section>

      <section className={styles.section} aria-labelledby="keep-looking">
        <h2 id="keep-looking">{t('catalog.keepLooking')}</h2>
        <ul className={styles.related}>
          {recipe.coffee?.slug ? (
            <li>
              <Link href={`/coffee/${recipe.coffee.slug}`}>
                {t('catalog.recipeDetail.aboutCoffee', { name: recipe.coffee.name })}
              </Link>
            </li>
          ) : null}
          {recipe.brewer ? (
            <li>
              <Link href={`/recipes?brewer=${recipe.brewer.slug}`}>
                {t('catalog.recipeDetail.moreBrewerRecipes', { name: recipe.brewer.name })}
              </Link>
            </li>
          ) : null}
          <li>
            <Link href={`/recipes?method=${recipe.method}`}>
              {t('catalog.recipeDetail.moreMethodRecipes', { method: method.toLowerCase() })}
            </Link>
          </li>
          <li>
            <Link href="/recipes">{t('catalog.recipeDetail.allRecipes')}</Link>
          </li>
        </ul>
      </section>
    </div>
  );
}
