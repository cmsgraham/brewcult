import Link from 'next/link';
import type { EspressoParams, FilterParams, RecipeView } from './catalog-api';
import styles from './catalog.module.css';
import {
  GRIND_CATEGORY_HINT,
  METHOD_LABEL,
  celsius,
  duration,
  grams,
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
export function recipeParams(recipe: RecipeView): Param[] {
  const params = recipe.params;
  const out: Param[] = [];
  if (params === null) return out;

  if (isEspresso(params)) {
    const dose = grams(params.dose_in_g);
    const yieldOut = grams(params.yield_out_g);
    if (dose) out.push({ label: 'Dose in', value: dose });
    if (yieldOut) out.push({ label: 'Yield out', value: yieldOut });
    const ratio = ratioText(params);
    if (ratio) out.push({ label: 'Ratio', value: ratio, note: 'dose to yield' });
    const shot = duration(params.shot_time_s);
    if (shot) out.push({ label: 'Shot time', value: shot });
    const temp = celsius(params.temperature_c);
    if (temp) out.push({ label: 'Temperature', value: temp });
    const preInfusion = duration(params.pre_infusion_s);
    if (preInfusion) out.push({ label: 'Pre-infusion', value: preInfusion });
    const basket = grams(params.basket_size_g);
    if (basket) out.push({ label: 'Basket', value: basket });
    return out;
  }

  if (isFilter(params)) {
    const dose = grams(params.dose_g);
    const water = grams(params.water_g);
    if (dose) out.push({ label: 'Coffee', value: dose });
    if (water) out.push({ label: 'Water', value: water });
    const ratio = ratioText(params);
    if (ratio) out.push({ label: 'Ratio', value: ratio, note: 'coffee to water' });
    const temp = celsius(params.temperature_c);
    if (temp) out.push({ label: 'Temperature', value: temp });
    const total = duration(params.brew_time_s);
    if (total) out.push({ label: 'Total time', value: total });
  }
  return out;
}

export function RecipeParams({ recipe }: { recipe: RecipeView }) {
  const params = recipeParams(recipe);
  if (params.length === 0) {
    return (
      <p className="bc-muted">
        This recipe has not recorded its numbers yet. The method and grind below are still
        useful — treat the rest as your call.
      </p>
    );
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
export function RecipeGrind({ recipe }: { recipe: RecipeView }) {
  const grind = recipe.grind;
  if (!grind) return null;

  const category = grindCategoryLabel(grind.category);
  const hint = grind.category ? GRIND_CATEGORY_HINT[grind.category] : null;

  return (
    <div>
      <ul className={styles.paramGrid}>
        <li className={styles.param}>
          <span className={styles.paramLabel}>Grind</span>
          <span className={styles.paramValue}>{category ?? 'Not recorded'}</span>
          {hint ? <span className={styles.paramNote}>{hint}</span> : null}
        </li>
        {grind.setting ? (
          <li className={styles.param}>
            <span className={styles.paramLabel}>Dial setting</span>
            <span className={styles.paramValue}>{grind.setting}</span>
            <span className={styles.paramNote}>
              {recipe.grinder ? `on the ${recipe.grinder.name}` : 'on the author’s grinder'}
              {grind.scale_type ? ` · ${grind.scale_type}` : ''}
            </span>
          </li>
        ) : null}
      </ul>
      <p className="bc-muted">
        {grind.setting ? (
          <>
            That dial number only applies to{' '}
            {recipe.grinder ? (
              <Link href={`/equipment/${recipe.grinder.slug}`}>{recipe.grinder.name}</Link>
            ) : (
              'the author’s grinder'
            )}
            . On yours, start from the <strong>{category?.toLowerCase()}</strong> category and
            adjust by taste — grind is the one setting worth changing first.
          </>
        ) : (
          <>
            No dial number was recorded, which is fine: the category is the part that
            transfers between grinders anyway.
          </>
        )}
      </p>
    </div>
  );
}

/** Pour schedule. The bloom is simply the first pour (§6.3), not a special field. */
export function RecipePours({ recipe }: { recipe: RecipeView }) {
  const params = recipe.params;
  if (!isFilter(params) || !params.pours || params.pours.length === 0) return null;

  return (
    <ol className={styles.pours}>
      {params.pours.map((pour, index) => (
        <li className={styles.pour} key={`${pour.at_s}-${pour.to_g}-${index}`}>
          <span className={styles.pourTime}>{duration(pour.at_s) ?? `${pour.at_s}s`}</span>
          {/* One string, not three nodes — see the note in grind-conversion.tsx. */}
          <span>{`up to ${pour.to_g} g`}</span>
          <span className="bc-muted">
            {pour.note ?? (index === 0 ? 'Bloom — wet the bed evenly and wait.' : '')}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Espresso puck-prep steps, when the author recorded them. */
export function RecipePuckPrep({ recipe }: { recipe: RecipeView }) {
  const params = recipe.params;
  if (!isEspresso(params) || !params.puck_prep || params.puck_prep.length === 0) return null;

  return (
    <ul className={styles.tags} aria-label="Puck preparation">
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
export function RecipeLineage({ recipe }: { recipe: RecipeView }) {
  if (!recipe.parent) return null;

  const upstream = authorName(recipe.parent.author ?? null);
  const changeCount = recipe.changed_fields.length;

  return (
    <p>
      Forked from <Link href={`/recipes/${recipe.parent.id}`}>{recipe.parent.title}</Link>
      {upstream ? ` by ${upstream}` : ''}
      {changeCount > 0
        ? ` — ${changeCount === 1 ? '1 change' : `${changeCount} changes`}: ${recipe.changed_fields
            .map((field) => humanize(field).toLowerCase())
            .join(', ')}.`
        : '.'}
    </p>
  );
}

/** One-line description of the recipe, reused for meta descriptions. */
export function recipeSummaryLine(recipe: RecipeView): string {
  const method = METHOD_LABEL[recipe.method] ?? recipe.method;
  const bits: string[] = [method];
  const ratio = ratioText(recipe.params);
  if (ratio) bits.push(ratio);
  const category = grindCategoryLabel(recipe.grind?.category);
  if (category) bits.push(`${category.toLowerCase()} grind`);
  if (recipe.brewer) bits.push(recipe.brewer.name);
  return bits.join(' · ');
}
