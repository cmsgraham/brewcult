import { LocaleLink as Link } from '../../components/locale-link';
import { localeParam, translator } from '../../lib/locale-server';
import type { LoadResult, Page, RecipeView } from './catalog-api';
import styles from './catalog.module.css';
import { RecipeCard } from './entity-cards';

/**
 * "Recipes for this coffee / on this brewer", with every failure mode handled.
 *
 * The recipes API is being built in parallel (Lane H) and currently 404s. A
 * missing sub-resource must never take a coffee page down, and — just as
 * important — it must not leave a silent hole where a reader expects content.
 * Three distinct states, three distinct honest messages:
 *
 *  - `missing`  → the endpoint is not there yet. Say so plainly; do not blame
 *                 the reader, do not pretend there are no recipes.
 *  - `error`    → something broke on our side. Say that too (§9.7 tone: "that
 *                 is on us, not on you").
 *  - empty list → the API answered and there genuinely are none. This is an
 *                 invitation, not an apology — an empty state is where §9.7
 *                 norm-setting does its work.
 */

export interface RecipesSectionProps {
  result: LoadResult<Page<RecipeView>>;
  /** Section heading, e.g. "Recipes for this coffee". */
  heading: string;
  headingId: string;
  /** Named in the empty state, e.g. "this coffee" / "the V60". */
  subject: string;
  /** Link to the filtered recipe hub, when one makes sense. */
  browseHref?: string;
  /** `heading` and `subject` arrive translated; this is for everything else. */
  locale?: string;
}

export function RecipesSection({
  result,
  heading,
  headingId,
  subject,
  browseHref,
  locale = 'en',
}: RecipesSectionProps) {
  const t = translator(localeParam(locale));

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId}>{heading}</h2>

      {result.status === 'ok' && result.data.items.length > 0 ? (
        <>
          <p className="bc-muted">{t('catalog.recipesSection.startingPoints')}</p>
          <ul className="bc-card-grid">
            {result.data.items.map((recipe) => (
              <RecipeCard key={recipe.id} recipe={recipe} locale={locale} />
            ))}
          </ul>
          {browseHref ? (
            <p>
              <Link href={browseHref}>{t('catalog.recipesSection.browseAll', { subject })}</Link>
            </p>
          ) : null}
        </>
      ) : result.status === 'error' ? (
        <p className="bc-muted">{t('catalog.recipesSection.loadError')}</p>
      ) : result.status === 'missing' ? (
        <p className="bc-muted">{t('catalog.recipesSection.notReady', { subject })}</p>
      ) : (
        <p className="bc-muted">{t('catalog.recipesSection.empty', { subject })}</p>
      )}
    </section>
  );
}
