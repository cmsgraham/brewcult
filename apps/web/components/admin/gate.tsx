import { LocaleLink as Link } from '../../components/locale-link';
import { MFA_SETUP_PATH, ROLE_LABEL, type AdminActor } from '../../lib/admin-client';
import styles from './admin.module.css';

/**
 * The staff-without-MFA screen (EF §3.2 — "admin/moderator/editor interfaces
 * live behind a separate auth surface with MFA enforced"; the API's `isStaff()`
 * demands `actor.mfa === true`).
 *
 * This is the screen that decides whether the console feels usable or broken, so
 * it does four things a bare "403 Forbidden" cannot:
 *
 *  1. Confirms the person is in the right place and has the right role — the
 *     problem is the *session*, not them.
 *  2. Distinguishes "you have no two-factor yet" from "you have it, but this
 *     session did not use it" — the second is fixed by signing in again, and
 *     without saying so the enrol link is a dead end for anyone already enrolled.
 *  3. Says what enrolling involves before they click.
 *  4. Renders **no action controls at all**. A disabled Suspend button here would
 *     just be a tease; there is exactly one next step and it is a link.
 */
export function MfaInterstitial({ actor }: { actor: AdminActor }) {
  const alreadyEnrolled = actor.mfaEnrolled;

  return (
    <div className="bc-stack">
      <p className={styles.eyebrow}>Operator console</p>
      <h1>Staff actions need two-factor authentication</h1>

      <p className="bc-lede">
        {alreadyEnrolled
          ? 'Two-factor is already on your account — this sign-in just did not use it. One fresh sign-in with your authenticator code and the console opens.'
          : 'You have the right role for this. What is missing is a second factor on your sign-in, and it takes about two minutes to add.'}
      </p>

      <div className="bc-panel bc-stack">
        <h2 style={{ marginTop: 0 }}>Why we ask</h2>
        <p style={{ marginBottom: 0 }}>
          Everything done in here — suspending an account, changing a role, resolving a
          report — is written to an append-only audit log with your name against it. That
          signature is only worth something if nobody else can produce it. A stolen password
          should not be able to suspend somebody&rsquo;s account.
        </p>
      </div>

      <section aria-labelledby="mfa-next" className="bc-stack">
        <h2 id="mfa-next">What happens next</h2>
        <ol>
          {alreadyEnrolled ? (
            <>
              <li>Sign out, then sign back in.</li>
              <li>Enter the six-digit code from your authenticator app when asked.</li>
              <li>Come back to this page — it will be the console.</li>
            </>
          ) : (
            <>
              <li>
                Scan one QR code with any authenticator app (1Password, Authy, Google
                Authenticator — all fine).
              </li>
              <li>Type the six-digit code back to confirm it works.</li>
              <li>
                Save the recovery codes somewhere that is not the same device. They are shown
                once.
              </li>
              <li>Sign in again with the code, and the console opens.</li>
            </>
          )}
        </ol>
      </section>

      <div className="bc-actions" style={{ marginTop: 0 }}>
        <Link className="bc-button" href={MFA_SETUP_PATH}>
          {alreadyEnrolled ? 'Go to two-factor settings' : 'Set up two-factor authentication'}
        </Link>
        <Link className="bc-button bc-button--quiet" href="/profile">
          Back to your profile
        </Link>
      </div>

      <p className={styles.pagerNote}>
        Signed in as @{actor.handle} · {ROLE_LABEL[actor.role]}. Nothing about your access has
        changed and nothing is wrong with your account.
      </p>
    </div>
  );
}
