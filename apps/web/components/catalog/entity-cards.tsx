import { LocaleLink as Link } from '../../components/locale-link';
import { EntityImage } from '../media/entity-image';
import type { CoffeeSummary, EquipmentSummary, RecipeView, RoasterSummary } from './catalog-api';
import { catalogCopy, grindCategoryLabel, originLabel, processLabel, roastLevelLabel } from './copy';

/**
 * Cards for the hub grids and the "more from…" rails on detail pages.
 *
 * All four use the existing `.bc-card` / `.bc-card-grid` classes from
 * globals.css rather than new styles — the card is already a solved problem and
 * a second visual language for the same object would be worse, not richer.
 *
 * Every card links, and every card names its neighbours (roaster, brand,
 * coffee) so the crawler walks the entity graph instead of hitting leaves.
 *
 * ── Images ───────────────────────────────────────────────────────────────────
 * `EntityImage` reads whichever key the API ends up using for a picture
 * (`image_url` / `imageUrl` / `image` / a nested media object) and renders
 * **nothing at all** when there is none — which is every entity today. The
 * text-only card is therefore unchanged until real artwork exists, rather than
 * every grid growing a row of empty grey rectangles. `fallback="monogram"` is
 * there for the day a surface wants uniform rows.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export function CoffeeCard({
  coffee,
  locale = 'en',
}: {
  coffee: CoffeeSummary;
  /** Which language the process and roast labels are written in. */
  locale?: string;
}) {
  const meta = [
    originLabel(coffee.origin),
    processLabel(coffee.process, locale),
    roastLevelLabel(coffee.roast_level, locale),
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ');

  return (
    <li className="bc-card">
      <EntityImage entity={coffee} alt={coffee.name} prefer="thumbnail" />
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
      <EntityImage entity={roaster} alt={roaster.name} prefer="thumbnail" shape="square" />
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

export function EquipmentCard({ equipment,
  locale = 'en',
}: { equipment: EquipmentSummary; locale?: string }) {
  const copy = catalogCopy(locale);
  return (
    <li className="bc-card">
      <EntityImage
        entity={equipment}
        alt={`${equipment.brand.name} ${equipment.name}`}
        prefer="thumbnail"
      />
      <h3>
        <Link href={`/equipment/${equipment.slug}`}>
          {`${equipment.brand.name} ${equipment.name}`}
        </Link>
      </h3>
      <p className="bc-card__meta">
        {copy.EQUIPMENT_CATEGORY_LABEL[equipment.category] ?? equipment.category}
      </p>
      {equipment.grind_scale_type ? (
        <p className="bc-card__meta">{equipment.grind_scale_type} adjustment</p>
      ) : null}
    </li>
  );
}

export function RecipeCard({ recipe,
  locale = 'en',
}: { recipe: RecipeView; locale?: string }) {
  const copy = catalogCopy(locale);
  const params = recipe.params;
  const ratio =
    params && typeof params.ratio === 'number' ? `1:${Math.round(params.ratio * 10) / 10}` : null;
  const grind = grindCategoryLabel(recipe.grind?.category);
  const meta = [copy.METHOD_LABEL[recipe.method] ?? recipe.method, ratio, grind]
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
