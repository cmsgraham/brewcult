import { LocaleLink as Link } from '../../components/locale-link';
import { localeParam, translator } from '../../lib/locale-server';
import type { EspressoParams, FilterParams, RecipeView } from './catalog-api';
import styles from './catalog.module.css';
import {
  catalogCopy,
  celsius,
  duration,
  grams,
  grindCategoryInline,
  grindCategoryLabel,
  humanize,
} from './copy';
import { authorName } from './entity-cards';

/**
 * The renderable half of a recipe: parameters, grind and pour schedule.
 *
 * §6.3 says filter and espresso are two schemas, not one — so this branches on
 * the discriminant instead of flattening both into a lowest-common-denominator
 * table that would show "yield: —" on a V60 recipe.
 *
 * §6.4 says grind is *(grinder, setting, scale)* plus a mandatory coarse
 * category. The category is therefore rendered first and always; the
 * device-specific number is shown as secondary information, explicitly scoped
 * to the grinder it was read off. A bare number is never displayed on its own.
 */

export function isEspresso(params: RecipeView['params']): params is EspressoParams {
  return params !== null && params.method === 'espresso';
}

export function isFilter(params: RecipeView['params']): params is FilterParams {
  return params !== null && (params.method === 'filter' || params.method === 'immersion');
}

/** `1:16.7` — derived when the API did not store it. */
export function ratioText(params: RecipeView['params']): string | null {
  if (params === null) return null;
  if (typeof params.ratio === 'number' && Number.isFinite(params.ratio) && params.ratio > 0) {
    return `1:${Math.round(params.ratio * 10) / 10}`;
  }
  if (isFilter(params) && params.dose_g > 0) {
    return `1:${Math.round((params.water_g / params.dose_g) * 10) / 10}`;
  }
  if (isEspresso(params) && params.dose_in_g > 0) {
    return `1:${Math.round((params.yield_out_g / params.dose_in_g) * 10) / 10}`;
  }
  return null;
}

interface Param {
  label: string;
  value: string;
  note?: string;
}

/** The parameter tiles, in the order a person actually uses them. */
export function recipeParams(recipe: RecipeView, locale = 'en'): Param[] {
  const t = translator(localeParam(locale));
  const params = recipe.params;
  const out: Param[] = [];
  if (params === null) return out;

  if (isEspresso(params)) {
    const dose = grams(params.dose_in_g);
    const yieldOut = grams(params.yield_out_g);
    if (dose) out.push({ label: t('catalog.recipeBody.doseIn'), value: dose });
    if (yieldOut) out.push({ label: t('catalog.recipeBody.yieldOut'), value: yieldOut });
    const ratio = ratioText(params);
    if (ratio) {
      out.push({
        label: t('catalog.recipeBody.ratio'),
        value: ratio,
        note: t('catalog.recipeBody.ratioEspressoNote'),
      });
    }
    const shot = duration(params.shot_time_s);
    if (shot) out.push({ label: t('catalog.recipeBody.shotTime'), value: shot });
    const temp = celsius(params.temperature_c);
    if (temp) out.push({ label: t('catalog.recipeBody.temperature'), value: temp });
    const preInfusion = duration(params.pre_infusion_s);
    if (preInfusion) out.push({ label: t('catalog.recipeBody.preInfusion'), value: preInfusion });
    const basket = grams(params.basket_size_g);
    if (basket) out.push({ label: t('catalog.recipeBody.basket'), value: basket });
    return out;
  }

  if (isFilter(params)) {
    const dose = grams(params.dose_g);
    const water = grams(params.water_g);
    if (dose) out.push({ label: t('catalog.recipeBody.coffee'), value: dose });
    if (water) out.push({ label: t('catalog.recipeBody.water'), value: water });
    const ratio = ratioText(params);
    if (ratio) {
      out.push({
        label: t('catalog.recipeBody.ratio'),
        value: ratio,
        note: t('catalog.recipeBody.ratioFilterNote'),
      });
    }
    const temp = celsius(params.temperature_c);
    if (temp) out.push({ label: t('catalog.recipeBody.temperature'), value: temp });
    const total = duration(params.brew_time_s);
    if (total) out.push({ label: t('catalog.recipeBody.totalTime'), value: total });
  }
  return out;
}

export function RecipeParams({
  recipe,
  locale = 'en',
}: {
  recipe: RecipeView;
  locale?: string;
}) {
  const t = translator(localeParam(locale));
  const params = recipeParams(recipe, locale);
  if (params.length === 0) {
    return <p className="bc-muted">{t('catalog.recipeBody.noNumbers')}</p>;
  }

  return (
    <ul className={styles.paramGrid}>
      {params.map((param) => (
        <li className={styles.param} key={param.label}>
          <span className={styles.paramLabel}>{param.label}</span>
          <span className={styles.paramValue}>{param.value}</span>
          {param.note ? <span className={styles.paramNote}>{param.note}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Grind, rendered the §6.4 way: the coarse category leads because it is the
 * only part that transfers, and the dial number is always attributed to a
 * specific grinder.
 */
export function RecipeGrind({ recipe,
  locale = 'en',
}: { recipe: RecipeView; locale?: string }) {
  const copy = catalogCopy(locale);
  const t = translator(localeParam(locale));
  const grind = recipe.grind;
  if (!grind) return null;

  const category = grindCategoryLabel(grind.category, locale);
  const hint = grind.category ? copy.GRIND_CATEGORY_HINT[grind.category] : null;

  return (
    <div>
      <ul className={styles.paramGrid}>
        <li className={styles.param}>
          <span className={styles.paramLabel}>{t('catalog.recipeBody.grind')}</span>
          <span className={styles.paramValue}>
            {category ?? t('catalog.recipeBody.notRecorded')}
          </span>
          {hint ? <span className={styles.paramNote}>{hint}</span> : null}
        </li>
        {grind.setting ? (
          <li className={styles.param}>
            <span className={styles.paramLabel}>{t('catalog.recipeBody.dialSetting')}</span>
            <span className={styles.paramValue}>{grind.setting}</span>
            <span className={styles.paramNote}>
              {recipe.grinder
                ? t('catalog.recipeBody.onGrinder', { name: recipe.grinder.name })
                : t('catalog.recipeBody.onAuthorsGrinder')}
              {grind.scale_type ? ` · ${grind.scale_type}` : ''}
            </span>
          </li>
        ) : null}
      </ul>
      <p className="bc-muted">
        {grind.setting ? (
          <>
            {t('catalog.recipeBody.dialAppliesTo')}
            {recipe.grinder ? (
              <Link href={`/equipment/${recipe.grinder.slug}`}>{recipe.grinder.name}</Link>
            ) : (
              t('catalog.recipeBody.authorsGrinder')
            )}
            {t('catalog.recipeBody.dialAdviceBefore')}
            <strong>{grindCategoryInline(grind.category, locale)}</strong>
            {t('catalog.recipeBody.dialAdviceAfter')}
          </>
        ) : (
          t('catalog.recipeBody.noDial')
        )}
      </p>
    </div>
  );
}

/** Pour schedule. The bloom is simply the first pour (§6.3), not a special field. */
export function RecipePours({
  recipe,
  locale = 'en',
}: {
  recipe: RecipeView;
  locale?: string;
}) {
  const t = translator(localeParam(locale));
  const params = recipe.params;
  if (!isFilter(params) || !params.pours || params.pours.length === 0) return null;

  return (
    <ol className={styles.pours}>
      {params.pours.map((pour, index) => (
        <li className={styles.pour} key={`${pour.at_s}-${pour.to_g}-${index}`}>
          <span className={styles.pourTime}>{duration(pour.at_s) ?? `${pour.at_s}s`}</span>
          {/* One string, not three nodes — see the note in grind-conversion.tsx. */}
          <span>{t('catalog.recipeBody.upTo', { grams: pour.to_g })}</span>
          <span className="bc-muted">
            {pour.note ?? (index === 0 ? t('catalog.recipeBody.bloomNote') : '')}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Espresso puck-prep steps, when the author recorded them. */
export function RecipePuckPrep({
  recipe,
  locale = 'en',
}: {
  recipe: RecipeView;
  locale?: string;
}) {
  const t = translator(localeParam(locale));
  const params = recipe.params;
  if (!isEspresso(params) || !params.puck_prep || params.puck_prep.length === 0) return null;

  return (
    <ul className={styles.tags} aria-label={t('catalog.recipeBody.puckPrepLabel')}>
      {params.puck_prep.map((step) => (
        <li className={styles.tag} key={step}>
          {humanize(step)}
        </li>
      ))}
    </ul>
  );
}

/**
 * Fork lineage (§6.6). Attribution to the upstream author is permanent and
 * displayed — this is the social contract that makes forking safe to do.
 */
export function RecipeLineage({
  recipe,
  locale = 'en',
}: {
  recipe: RecipeView;
  locale?: string;
}) {
  const t = translator(localeParam(locale));
  if (!recipe.parent) return null;

  const upstream = authorName(recipe.parent.author ?? null);
  const changeCount = recipe.changed_fields.length;
  const fields = recipe.changed_fields.map((field) => humanize(field).toLowerCase()).join(', ');

  return (
    <p>
      {t('catalog.recipeBody.forkedFrom')}
      <Link href={`/recipes/${recipe.parent.id}`}>{recipe.parent.title}</Link>
      {upstream ? t('catalog.recipeBody.forkedBy', { author: upstream }) : ''}
      {changeCount === 0
        ? '.'
        : changeCount === 1
          ? t('catalog.recipeBody.changeOne', { fields })
          : t('catalog.recipeBody.changeOther', { count: changeCount, fields })}
    </p>
  );
}

/** One-line description of the recipe, reused for meta descriptions. */
export function recipeSummaryLine(recipe: RecipeView, locale = 'en'): string {
  const copy = catalogCopy(locale);
  const t = translator(localeParam(locale));
  const method = copy.METHOD_LABEL[recipe.method] ?? recipe.method;
  const bits: string[] = [method];
  const ratio = ratioText(recipe.params);
  if (ratio) bits.push(ratio);
  const category = grindCategoryInline(recipe.grind?.category, locale);
  if (category) bits.push(t('catalog.recipeBody.grindSummary', { category }));
  if (recipe.brewer) bits.push(recipe.brewer.name);
  return bits.join(' · ');
}
