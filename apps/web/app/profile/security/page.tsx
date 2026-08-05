import { type Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SecurityPanel } from '../../../components/security/security-panel';
import { fetchMfaStatus } from '../../../lib/mfa-client';
import { SessionRestoreScreen } from '../../../components/session-restore-screen';
import { canRestoreSession, serverApiFetch } from '../../../lib/server-api';

export const metadata: Metadata = {
  title: 'Two-factor authentication',
  description: 'Add a second step to your BrewCult sign-in.',
  robots: { index: false, follow: false },
};

/** Personal data — never cached, never statically rendered. */
export const dynamic = 'force-dynamic';

/**
 * `/profile/security` — the destination the operator console's MFA interstitial
 * links to (`admin-client.ts#MFA_SETUP_PATH`). Until this existed, an admin
 * could be promoted and then never actually use the role: the console sent them
 * to a 404.
 *
 * The status read happens on the server so the first paint already knows which
 * of the three states to show — no flash of "two-factor is off" for somebody who
 * has had it on for a year. Everything that touches a secret is in the client
 * component below.
 */
export default async function SecurityPage() {
  const actor = await fetchMfaStatus(serverApiFetch);

  // Same reasoning as /profile: a page render cannot see a scoped refresh
  // cookie, so "no actor" may only mean "ask the browser".
  if (!actor) {
    if (await canRestoreSession()) return <SessionRestoreScreen next="/profile/security" />;
    redirect('/login?next=%2Fprofile%2Fsecurity');
  }

  return (
    <div className="bc-stack">
      <p className="bc-muted" style={{ marginBottom: 0 }}>
        <Link href="/profile">← Your profile</Link>
      </p>

      <h1>Signing in safely</h1>

      <p className="bc-lede">
        Two-factor authentication means a sign-in needs two things: your password, and a code
        that changes every thirty seconds on a device you are holding. It is the single most
        effective thing you can do for your account, and you can turn it off again whenever you
        want.
      </p>

      <SecurityPanel
        handle={actor.handle}
        role={actor.role}
        enrolled={actor.mfaEnrolled}
        sessionVerified={actor.mfaSession}
      />

      <section aria-labelledby="mfa-honest-heading" className="bc-panel bc-stack">
        <h2 id="mfa-honest-heading" style={{ marginTop: 0 }}>
          The honest version
        </h2>
        <p>
          Two-factor is not about us not trusting you. Passwords get reused, and the leak is
          usually somewhere else entirely — a forum from 2014, a shop that stored them badly.
          A second factor means that leak stops being your problem.
        </p>
        <p>
          If you hold a staff role, we require it, and the reason is narrow: everything done in
          the operator console is written to an append-only log with a name against it. That
          record is only meaningful if the person named is the only one who could have done it.
        </p>
        <p style={{ marginBottom: 0 }}>
          We never see your codes and we cannot generate them. If you lose your phone, the
          recovery codes are the way back in — which is why the setup makes such a fuss about
          saving them.
        </p>
      </section>
    </div>
  );
}
