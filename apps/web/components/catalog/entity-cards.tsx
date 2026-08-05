import Link from 'next/link';
import type { CoffeeSummary, EquipmentSummary, RecipeView, RoasterSummary } from './catalog-api';
import {
  EQUIPMENT_CATEGORY_LABEL,
  METHOD_LABEL,
  grindCategoryLabel,
  originLabel,
  processLabel,
  roastLevelLabel,
} from './copy';

/**
 * Cards for the hub grids and the "more from…" rails on detail pages.
 *
 * All four use the existing `.bc-card` / `.bc-card-grid` classes from
 * globals.css rather than new styles — the card is already a solved problem and
 * a second visual language for the same object would be worse, not richer.
 *
 * Every card links, and every card names its neighbours (roaster, brand,
 * coffee) so the crawler walks the entity graph instead of hitting leaves.
 */

export function CoffeeCard({ coffee }: { coffee: CoffeeSummary }) {
  const meta = [originLabel(coffee.origin), processLabel(coffee.process), roastLevelLabel(coffee.roast_level)]
    .filter((part): part is string => Boolean(part))
    .join(' · ');

  return (
    <li className="bc-card">
      <h3>
        <Link href={`/coffee/${coffee.slug}`}>{coffee.name}</Link>
      </h3>
      {coffee.roaster ? (
        <p className="bc-card__meta">
          <Link href={`/roaster/${coffee.roaster.slug}`}>{coffee.roaster.name}</Link>
        </p>
      ) : null}
      {meta ? <p className="bc-card__meta">{meta}</p> : null}
      {coffee.tasting_notes?.length ? (
        <p className="bc-card__meta">Tastes like: {coffee.tasting_notes.join(', ')}</p>
      ) : null}
      {coffee.status === 'discontinued' ? (
        <p className="bc-card__meta">No longer roasted — kept for the recipes attached to it.</p>
      ) : null}
    </li>
  );
}

export function RoasterCard({ roaster }: { roaster: RoasterSummary }) {
  return (
    <li className="bc-card">
      <h3>
        <Link href={`/roaster/${roaster.slug}`}>{roaster.name}</Link>
      </h3>
      {roaster.location ? <p className="bc-card__meta">{roaster.location}</p> : null}
      <p className="bc-card__meta">
        {roaster.coffee_count === 1 ? '1 coffee' : `${roaster.coffee_count} coffees`} in the
        catalogue
      </p>
    </li>
  );
}

export function EquipmentCard({ equipment }: { equipment: EquipmentSummary }) {
  return (
    <li className="bc-card">
      <h3>
        <Link href={`/equipment/${equipment.slug}`}>
          {`${equipment.brand.name} ${equipment.name}`}
        </Link>
      </h3>
      <p className="bc-card__meta">
        {EQUIPMENT_CATEGORY_LABEL[equipment.category] ?? equipment.category}
      </p>
      {equipment.grind_scale_type ? (
        <p className="bc-card__meta">{equipment.grind_scale_type} adjustment</p>
      ) : null}
    </li>
  );
}

export function RecipeCard({ recipe }: { recipe: RecipeView }) {
  const params = recipe.params;
  const ratio =
    params && typeof params.ratio === 'number' ? `1:${Math.round(params.ratio * 10) / 10}` : null;
  const grind = grindCategoryLabel(recipe.grind?.category);
  const meta = [METHOD_LABEL[recipe.method] ?? recipe.method, ratio, grind]
    .filter((part): part is string => Boolean(part))
    .join(' · ');

  return (
    <li className="bc-card">
      <h3>
        <Link href={`/recipes/${recipe.id}`}>{recipe.title}</Link>
      </h3>
      <p className="bc-card__meta">{meta}</p>
      {recipe.brewer ? (
        <p className="bc-card__meta">
          On the <Link href={`/equipment/${recipe.brewer.slug}`}>{recipe.brewer.name}</Link>
        </p>
      ) : null}
      <p className="bc-card__meta">
        {recipe.is_official
          ? 'Published by the roaster'
          : `By ${authorName(recipe.author) ?? 'a community member'}`}
      </p>
    </li>
  );
}

/** "@anna" / "Anna" / null — attribution is permanent (§6.6) so it is never
 *  silently dropped, but a recipe with no author still renders. */
export function authorName(author: RecipeView['author']): string | null {
  if (!author) return null;
  if (author.display_name) return author.display_name;
  if (author.handle) return `@${author.handle}`;
  return null;
}
