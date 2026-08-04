import Link from 'next/link';
import { type CoffeeSummary } from '../../lib/api';

export function CoffeeCard({ coffee }: { coffee: CoffeeSummary }) {
  const meta = [coffee.origin, coffee.process, coffee.roastLevel].filter(Boolean).join(' · ');

  return (
    <li className="bc-card">
      <h3>
        <Link href={`/discover/${coffee.slug}`}>{coffee.name}</Link>
      </h3>
      {coffee.roasterName ? <p className="bc-card__meta">{coffee.roasterName}</p> : null}
      {meta ? <p className="bc-card__meta">{meta}</p> : null}
      {coffee.tastingNotes && coffee.tastingNotes.length > 0 ? (
        <p className="bc-card__meta">Tastes like: {coffee.tastingNotes.join(', ')}</p>
      ) : null}
    </li>
  );
}
