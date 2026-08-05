import { type Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Offline',
  description: 'BrewCult works without a connection.',
  robots: { index: false, follow: false },
};

/**
 * The service worker's navigation fallback (public/sw.js).
 *
 * Precached at install, so a cold start with no signal lands here instead of on
 * the browser's dinosaur — and the message is the true one: brews logged while
 * offline are safe on the device and sync themselves later.
 */
export default function BrewOfflinePage() {
  return (
    <div className="bc-stack">
      <h1>You&rsquo;re offline</h1>
      <p className="bc-lede">
        Nothing is lost. Any brew you logged is stored on this device and syncs itself the
        moment you have signal again — you don&rsquo;t have to do anything.
      </p>
      <p>
        <Link className="bc-button" href="/brew">
          Back to the logger
        </Link>
      </p>
    </div>
  );
}
