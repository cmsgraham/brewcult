import Link from 'next/link';
import { type CoffeeSummary } from '../../lib/api';
import { EntityImage } from '../media/entity-image';

const ROAST_LEVEL_LABEL: Record<string, string> = {
  light: 'Light roast',
  medium_light: 'Medium-light roast',
  medium: 'Medium roast',
  medium_dark: 'Medium-dark roast',
  dark: 'Dark roast',
};

export function CoffeeCard({ coffee }: { coffee: CoffeeSummary }) {
  // The API returns nested refs and snake_case (see catalog module types).
  // Reading camelCase here rendered every card as a bare name with no metadata.
  const originLabel = coffee.origin
    ? [coffee.origin.region, coffee.origin.country].filter(Boolean).join(', ')
    : null;
  const roastLabel = coffee.roast_level
    ? (ROAST_LEVEL_LABEL[coffee.roast_level] ?? coffee.roast_level)
    : null;
  const meta = [originLabel, coffee.process, roastLabel].filter(Boolean).join(' · ');
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
