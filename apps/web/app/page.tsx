import { type Metadata } from 'next';
import Link from 'next/link';
import { getSessionUser } from '../lib/server-api';

export const metadata: Metadata = {
  title: 'BrewCult — brewing intelligence for people who love coffee',
  description:
    'Log a brew in ten seconds, learn what actually changed the cup, and find coffee worth drinking. Beginners welcome.',
  alternates: { canonical: '/' },
};

export default async function HomePage() {
  const user = await getSessionUser();

  return (
    <div className="bc-hero">
      <h1>Coffee gets better when you pay attention.</h1>
      <p className="bc-lede">
        BrewCult attaches to the habit you already have. Log the brew you were going to
        make anyway, and get something useful back: what changed, what to try next, and
        which coffees are worth your money.
      </p>
      <p>
        Every great brewer started with bitter coffee. Bring whatever gear you own — a
        great cup is absolutely possible on your setup, and nobody here is going to tell
        you to buy a $700 grinder first.
      </p>

      <div className="bc-actions">
        {user ? (
          <>
            <Link className="bc-button" href="/discover">
              Discover coffee
            </Link>
            <Link className="bc-button bc-button--secondary" href="/profile">
              Your profile
            </Link>
          </>
        ) : (
          <>
            <Link className="bc-button" href="/register">
              Create an account
            </Link>
            <Link className="bc-button bc-button--secondary" href="/discover">
              Look around first
            </Link>
          </>
        )}
      </div>

      <ul className="bc-feature-grid">
        <li className="bc-card">
          <h2>A brew log, not homework</h2>
          <p className="bc-card__meta">
            Ten seconds, one tap to repeat yesterday. It works with one bar of wifi in the
            kitchen, because that is where brewing happens.
          </p>
        </li>
        <li className="bc-card">
          <h2>Suggestions, never orders</h2>
          <p className="bc-card__meta">
            &ldquo;Try grinding finer&rdquo; — then you decide. Experiments are the point,
            and one that flops is still useful data.
          </p>
        </li>
        <li className="bc-card">
          <h2>Questions are welcome</h2>
          <p className="bc-card__meta">
            No downvotes, no gear-shaming. Patient explanation is what earns status here.
          </p>
        </li>
      </ul>
    </div>
  );
}
