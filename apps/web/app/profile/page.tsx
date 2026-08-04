import { type Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AccountActions } from '../../components/profile/account-actions';
import { Alert } from '../../components/ui/alert';
import { fetchClientConfig } from '../../lib/client-config';
import { getSessionUser } from '../../lib/server-api';

export const metadata: Metadata = {
  title: 'Your profile',
  description: 'Your BrewCult account, equipment and data controls.',
  robots: { index: false, follow: false },
};

/** Personal data — never cached, never statically rendered. */
export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const [user, config] = await Promise.all([getSessionUser(), fetchClientConfig()]);

  if (!user) redirect('/login?next=%2Fprofile');

  return (
    <div className="bc-stack">
      <h1>{user.displayName ?? user.handle}</h1>
      <p className="bc-muted">
        @{user.handle} · {user.email}
        {user.emailVerified === false ? ' · email not confirmed yet' : ''}
      </p>

      {user.emailVerified === false ? (
        <Alert tone="info" title="One small thing.">
          Confirm your email address so we can send reset links and order updates. The link
          is in your inbox — <Link href="/verify-email">details here</Link>.
        </Alert>
      ) : null}

      <section aria-labelledby="equipment-heading" className="bc-stack">
        <h2 id="equipment-heading">Your equipment</h2>
        <p className="bc-muted">
          Whatever you own is the right starting point. Telling us about it lets suggestions
          talk in your grinder&rsquo;s numbers instead of somebody else&rsquo;s.
        </p>
        <ul className="bc-card-grid">
          <li className="bc-card">
            <h3>No gear added yet</h3>
            <p className="bc-card__meta">
              Grinders, brewers, kettles and scales land here. The equipment picker arrives
              with the brew logger — nothing to do for now.
            </p>
          </li>
        </ul>
      </section>

      {/* EF §4.5 — plainly worded, at the place where the switch will live. */}
      <section aria-labelledby="personalisation-heading" className="bc-panel bc-stack">
        <h2 id="personalisation-heading">Personalisation, in plain words</h2>
        <p>
          Every brew you log — coffee, grind, ratio, how it tasted — builds a taste profile
          that belongs to you. We use it for three things: suggesting coffees you are likely
          to enjoy, suggesting dial-in tweaks, and ordering what you see first. That is the
          whole list. We do not sell it, and it does not feed anybody&rsquo;s advertising.
        </p>
        <p>
          You can switch personalisation off. Suggestions get more generic; nothing else
          changes, and no feature locks. The off switch ships with the taste profile itself
          — this page will hold it, and it will be a toggle, not a form.
        </p>
        <p style={{ marginBottom: 0 }}>
          Product email you always get (order status, password resets). Marketing email is
          opt-in only, and the weekly briefing is one click to stop. Read the full{' '}
          <Link href="/privacy">privacy policy</Link> for the retention detail.
        </p>
      </section>

      <section aria-labelledby="data-heading" className="bc-stack">
        <h2 id="data-heading">Your data is yours</h2>
        <p className="bc-muted">
          Export gives you everything in a machine-readable file — brews, recipes, posts and
          taste profile. Deletion means deletion. Both are self-serve, because data you can
          walk away with is data worth investing in.
        </p>
        <AccountActions
          exportEnabled={config.features.accountExport}
          deletionEnabled={config.features.accountDeletion}
        />
      </section>
    </div>
  );
}
