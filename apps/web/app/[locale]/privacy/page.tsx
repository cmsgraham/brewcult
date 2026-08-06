import { type Metadata } from 'next';
import { LocaleLink as Link } from '../../../components/locale-link';

export const metadata: Metadata = {
  title: 'Privacy',
  description:
    'What BrewCult collects, why, how long we keep it, and how to take it back.',
  alternates: { canonical: '/privacy' },
};

/**
 * Plain-language summary (EF §4.5). The reviewed legal text lands before public
 * launch; this page exists now because the signup flow links to it, and an
 * unlinked promise is not a promise.
 */
export default function PrivacyPage() {
  return (
    <div className="bc-stack">
      <h1>Privacy</h1>
      <p className="bc-lede">
        The short version: we collect what makes your coffee better, we tell you what it is
        for, and you can take all of it with you or delete it whenever you like.
      </p>

      <h2>What we collect</h2>
      <p>
        Your account details (email, handle, display name), the brews and recipes you log,
        the equipment you tell us about, what you post, and — if you buy something later —
        the order records tax law makes us keep. Analytics are first-party and aggregate.
      </p>

      <h2>Why</h2>
      <p>
        Brew logs build a taste profile, which drives coffee suggestions and dial-in advice.
        That is the product. Email addresses let us send order updates and password resets.
        Marketing email is opt-in; the weekly briefing is one click to stop.
      </p>

      <h2>How long</h2>
      <p>
        Account data lives as long as the account does. Deleting your account hard-deletes
        personal data within 30 days. Public recipes other people have forked are anonymised
        rather than destroyed, so their work does not break — we say so plainly at the
        moment you delete, not afterwards.
      </p>

      <h2>Your controls</h2>
      <p>
        Export and deletion are self-serve from <Link href="/profile">your profile</Link>.
        Personalisation has an off switch; turning it off makes suggestions blander and
        locks you out of nothing. Age 16+ applies to accounts.
      </p>

      <h2>Who else sees it</h2>
      <p>
        Only the processors we need to run the service — hosting, email, payments (later),
        and the AI provider for brewing advice, with payloads kept minimal. Each one is
        listed in our processor inventory with what it holds and for how long.
      </p>

      <p className="bc-muted">
        This is the plain-language summary. The full reviewed policy is published before
        public launch; nothing in it will contradict this page.
      </p>
    </div>
  );
}
