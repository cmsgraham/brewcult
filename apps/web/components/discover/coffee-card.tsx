import Link from 'next/link';
import { type CoffeeSummary } from '../../lib/api';
import { catalogCopy, processLabel } from '../catalog/copy';
import { EntityImage } from '../media/entity-image';

/**
 * The roast labels come from the shared catalogue vocabulary now.
 *
 * This file used to carry its own copy of them — five strings that drifted from
 * the catalog module's (`medium_light` here, `medium-light` there) and that
 * would have stayed English forever once the rest of the site learned Spanish.
 * One vocabulary, one place to translate it.
 */
export function CoffeeCard({
  coffee,
  locale = 'en',
}: {
  coffee: CoffeeSummary;
  locale?: string;
}) {
  const copy = catalogCopy(locale);
  // The API returns nested refs and snake_case (see catalog module types).
  // Reading camelCase here rendered every card as a bare name with no metadata.
  const originLabel = coffee.origin
    ? [coffee.origin.region, coffee.origin.country].filter(Boolean).join(', ')
    : null;
  const roastLabel = coffee.roast_level
    ? (copy.ROAST_LEVEL_LABEL[coffee.roast_level as keyof typeof copy.ROAST_LEVEL_LABEL] ??
       coffee.roast_level)
    : null;
  // The process was rendered raw ("washed"); it has a label like everything else.
  const process = processLabel(coffee.process as never, locale) ?? coffee.process;
  const meta = [originLabel, process, roastLabel].filter(Boolean).join(' · ');
  const notes = coffee.tasting_notes ?? [];

  return (
    <li className="bc-card">
      {/* Renders only when the payload carries a picture. No image means the
          card stays exactly as it ships today — a clean text card, which is an
          intentional look, not a broken one. */}
      <EntityImage entity={coffee} alt={coffee.name} prefer="thumbnail" />
      <h3>
        {/* Detail pages live at /coffee/[slug]; /discover is the browse surface. */}
        <Link href={`/coffee/${coffee.slug}`}>{coffee.name}</Link>
      </h3>
      {coffee.roaster?.name ? <p className="bc-card__meta">{coffee.roaster.name}</p> : null}
      {meta ? <p className="bc-card__meta">{meta}</p> : null}
      {notes.length > 0 ? <p className="bc-card__meta">Tastes like: {notes.join(', ')}</p> : null}
    </li>
  );
}
