import { type Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MfaInterstitial } from '../../../components/admin/gate';
import { SessionRestoreScreen } from '../../../components/session-restore-screen';
import { AdminShell } from '../../../components/admin/shell';
import { UsersConsole } from '../../../components/admin/users-console';
import { adminGate } from '../_lib/guard';

export const metadata: Metadata = {
  title: 'People · Operator console',
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = 'force-dynamic';

/**
 * People directory (deliverable 2).
 *
 * The gate runs on the server; the table itself is a client component because
 * the search term must stay out of the URL (P2 personal data — see
 * components/admin/users-console.tsx for the full reasoning).
 */
export default async function AdminUsersPage() {
  const gate = await adminGate();
  // Not "no such page" — "we could not read your session". A 404 here sends an
  // operator looking for a deleted feature; the truth is an expired cookie.
  if (gate.state === 'restore') return <SessionRestoreScreen next="/admin/users" />;
  if (gate.state === 'unavailable') notFound();
  if (gate.state === 'mfa-required') return <MfaInterstitial actor={gate.actor} />;

  return (
    <AdminShell
      current="users"
      title="People"
      lede="Search by handle, email or id. Every action asks you to confirm what it will do before it does it."
      actor={gate.actor}
    >
      <UsersConsole />
    </AdminShell>
  );
}
