import { type Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AvatarEditor } from '../../../components/media/avatar-editor';
import { AccountActions } from '../../../components/profile/account-actions';
import { AddCoffee } from '../../../components/coffee/add-coffee';
import { EquipmentManager } from '../../../components/profile/equipment-manager';
import { SignOutButton } from '../../../components/profile/sign-out-button';
import { Alert } from '../../../components/ui/alert';
import { fetchClientConfig } from '../../../lib/client-config';
import { readAvatarUrl } from '../../../lib/media-client';
import { SessionRestoreScreen } from '../../../components/session-restore-screen';
import { canRestoreSession, getSessionUser } from '../../../lib/server-api';

export const metadata: Metadata = {
  title: 'Your profile',
  description: 'Your BrewCult account, equipment and data controls.',
  robots: { index: false, follow: false },
};

/** Personal data — never cached, never statically rendered. */
export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const [user, config] = await Promise.all([getSessionUser(), fetchClientConfig()]);

  // A null user here is not proof of a stranger — the refresh cookie is
  // scoped to the auth path, so a page navigation carries nothing once the
  // access cookie has expired. Ask the browser before giving up on them.
  if (!user) {
    if (await canRestoreSession()) return <SessionRestoreScreen next="/profile" />;
    redirect('/login?next=%2Fprofile');
  }

  return (
    <div className="bc-stack">
      <h1>{user.displayName ?? user.handle}</h1>
      <p className="bc-muted">
        @{user.handle} · {user.email}
        {user.emailVerified === false ? ' · email not confirmed yet' : ''}
      </p>

      {/* Sign out sits up here, next to who you are, and deliberately NOWHERE
          NEAR the delete button further down: those two are not neighbours you
          want on a small screen. Until now the only sign-out in the product was
          buried in the security panel, which meant no discoverable way to leave
          on a shared device. */}
      <div className="bc-actions" style={{ marginTop: 0 }}>
        <SignOutButton />
      </div>

      {user.emailVerified === false ? (
        <Alert tone="info" title="One small thing.">
          Confirm your email address so we can send reset links and order updates. The link
          is in your inbox — <Link href="/verify-email">details here</Link>.
        </Alert>
      ) : null}

      {/* Read tolerantly: the avatar field's exact spelling is still settling on
          the API side, and an absent one simply means initials. */}
      <section aria-labelledby="photo-heading" className="bc-stack">
        <h2 id="photo-heading">Your photo</h2>
        <AvatarEditor
          initialUrl={readAvatarUrl(user)}
          displayName={user.displayName ?? null}
          handle={user.handle}
        />
      </section>

      {/* The MFA page has existed since ID-07 with no entry point anywhere in
          the product — you could only reach it from the operator console's
          interstitial. This is that entry point. */}
      {/* Every feature needs a way in (second_draft §30.4): a preferences screen
          nobody can find is a preferences screen nobody uses, and the only
          other route to it is the footer of an email they may have deleted. */}
      <section aria-labelledby="email-heading" className="bc-stack">
        <h2 id="email-heading">Email</h2>
        <p className="bc-muted">
          We send a weekly recap of your own brews and a note when someone builds on one of
          your recipes. Both are one click to switch off, and we never send marketing.
        </p>
        <p>
          <Link className="bc-button bc-button--secondary" href="/profile/notifications">
            Email settings
          </Link>
        </p>
      </section>

      <section aria-labelledby="security-heading" className="bc-stack">
        <h2 id="security-heading">Signing in safely</h2>
        <p className="bc-muted">
          Two-factor authentication means a sign-in needs your password and a code from a
          device you are holding. It takes about a minute to set up, and you can turn it off
          again whenever you like.
        </p>
        <p style={{ marginBottom: 0 }}>
          <Link href="/profile/security">Two-factor authentication →</Link>
        </p>
      </section>

      <section aria-labelledby="equipment-heading" className="bc-stack">
        <h2 id="equipment-heading">Your equipment</h2>
        <p className="bc-muted">
          Whatever you own is the right starting point. Telling us about it lets suggestions
          talk in your grinder&rsquo;s numbers instead of somebody else&rsquo;s.
        </p>
        <EquipmentManager />
      </section>

      <section aria-labelledby="shelf-heading" className="bc-stack">
        <h2 id="shelf-heading">Your coffee</h2>
        <p className="bc-muted" style={{ marginBottom: 0 }}>
          Bags you are drinking. Photograph one and the label fills the rest in.
        </p>
        <AddCoffee compact />
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
          userId={user.id}
          exportEnabled={config.features.accountExport}
          deletionEnabled={config.features.accountDeletion}
        />
      </section>
    </div>
  );
}
