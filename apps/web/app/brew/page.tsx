import { type Metadata } from 'next';
import { BrewLogger } from '../../components/logger/brew-logger';
import './logger.css';

export const metadata: Metadata = {
  title: 'Log a brew',
  description: 'Log a brew in one tap — your last recipe, prefilled, with steppers instead of a form.',
  robots: { index: false, follow: false },
};

/**
 * The brew logger (BREW-02/03/04).
 *
 * Rendered on the client and hydrated from IndexedDB rather than server-fetched:
 * the screen has to be interactive before any network response (§5), and the
 * device — not the server — is the source of truth for a brew until it syncs.
 * That is also why this route is never cached or prerendered with data.
 */
export const dynamic = 'force-dynamic';

export default function BrewPage() {
  return (
    <div className="bc-stack">
      <h1 className="bc-visually-hidden">Log a brew</h1>
      <BrewLogger />
      <p className="bc-muted bc-logger__footnote">
        Filter and immersion for now. Espresso lands once this card clears its fifteen-second
        bar with real people.
      </p>
    </div>
  );
}
