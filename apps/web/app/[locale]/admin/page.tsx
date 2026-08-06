import { type Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MfaInterstitial } from '../../../components/admin/gate';
import { SessionRestoreScreen } from '../../../components/session-restore-screen';
import { AdminShell } from '../../../components/admin/shell';
import { adminGate, serverAdminClient } from './_lib/guard';

export const metadata: Metadata = {
  title: 'Operator console',
  // Never indexed, never followed, never in the sitemap. The console should not
  // exist as far as any crawler is concerned.
  robots: { index: false, follow: false, nocache: true },
};

/** Staff data, per request, never cached and never statically rendered. */
export const dynamic = 'force-dynamic';

/**
 * Operator console — overview (deliverable 1).
 *
 * Three states, decided on the server (see `_lib/guard.ts`):
 *  - not staff (including signed out) → the ordinary site 404. No hint that
 *    there is anything here to be denied.
 *  - staff without an MFA-backed session → the enrol interstitial, no controls.
 *  - staff with MFA → the console.
 */
export default async function AdminOverviewPage() {
  const gate = await adminGate();
  // Not "no such page" — "we could not read your session". A 404 here sends an
  // operator looking for a deleted feature; the truth is an expired cookie.
  if (gate.state === 'restore') return <SessionRestoreScreen next="/admin" />;
  if (gate.state === 'unavailable') notFound();
  if (gate.state === 'mfa-required') return <MfaInterstitial actor={gate.actor} />;

  // Queue depths are nice-to-have, not load-bearing: either endpoint may be
  // unbuilt (Lane K), so a failure yields `null` and the card just omits a count.
  const [reports, applications] = await Promise.all([
    serverAdminClient.listReports({ status: 'open' }).catch(() => null),
    serverAdminClient.listSellerApplications({ status: 'pending' }).catch(() => null),
  ]);

  const depth = (page: { items: unknown[]; next_cursor?: string | null } | null): string | null => {
    if (page === null) return null;
    const count = page.items.length;
    if (count === 0) return 'Nothing waiting';
    return page.next_cursor ? `${count}+ waiting` : `${count} waiting`;
  };

  return (
    <AdminShell
      current="overview"
      title="Operator console"
      lede="Accounts, applications, reports and the audit trail. Everything in here is a staff action: confirmed before it happens, logged after."
      actor={gate.actor}
    >
      <ul className="bc-card-grid">
        <li className="bc-card">
          <h3>
            <Link href="/admin/users">People</Link>
          </h3>
          <p className="bc-card__meta">
            Find an account, read its history, suspend or reactivate it, sign it out
            everywhere, change its role. Emails are personal data — look at what you need for
            the job in front of you.
          </p>
        </li>
        <li className="bc-card">
          <h3>
            <Link href="/admin/seller-applications">Seller applications</Link>
          </h3>
          <p className="bc-card__meta">
            {depth(applications) ?? 'Queue depth unavailable'} · approving grants the seller
            owner role, so read the application before you do.
          </p>
        </li>
        <li className="bc-card">
          <h3>
            <Link href="/admin/reports">Reports</Link>
          </h3>
          <p className="bc-card__meta">
            {depth(reports) ?? 'Queue depth unavailable'} · claim one so two people are not
            working the same thing, then record what you found.
          </p>
        </li>
        <li className="bc-card">
          <h3>
            <Link href="/admin/audit">Audit log</Link>
          </h3>
          <p className="bc-card__meta">
            Append-only record of every staff action, including yours. Read-only by design —
            corrections are new entries.
          </p>
        </li>
      </ul>

      <section aria-labelledby="house-rules" className="bc-panel bc-stack">
        <h2 id="house-rules" style={{ marginTop: 0 }}>
          How this console behaves
        </h2>
        <p>
          Anything that changes an account asks you to confirm first, in a sentence that says
          what will actually happen to the person. Suspensions and role changes need a written
          reason; that reason goes on the audit log and can be quoted back to them.
        </p>
        <p style={{ marginBottom: 0 }}>
          The server decides what you are allowed to do, not this page. If an action comes back
          refused, that is the answer — reloading will not change it, and the console will tell
          you when the fix is on your side (a two-factor prompt, usually).
        </p>
      </section>
    </AdminShell>
  );
}
