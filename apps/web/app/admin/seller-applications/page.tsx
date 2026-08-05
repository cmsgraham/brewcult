import { type Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MfaInterstitial } from '../../../components/admin/gate';
import { SessionRestoreScreen } from '../../../components/session-restore-screen';
import { SellerApplicationsConsole } from '../../../components/admin/seller-applications-console';
import { AdminShell } from '../../../components/admin/shell';
import { adminGate } from '../_lib/guard';

export const metadata: Metadata = {
  title: 'Seller applications · Operator console',
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = 'force-dynamic';

/** Seller application queue (deliverable 4). */
export default async function AdminSellerApplicationsPage() {
  const gate = await adminGate();
  // Not "no such page" — "we could not read your session". A 404 here sends an
  // operator looking for a deleted feature; the truth is an expired cookie.
  if (gate.state === 'restore') return <SessionRestoreScreen next="/admin/seller-applications" />;
  if (gate.state === 'unavailable') notFound();
  if (gate.state === 'mfa-required') return <MfaInterstitial actor={gate.actor} />;

  return (
    <AdminShell
      current="seller-applications"
      title="Seller applications"
      lede="Approving grants the seller owner role and opens the marketplace tools to them. Declining needs a reason someone could act on."
      actor={gate.actor}
    >
      <SellerApplicationsConsole />
    </AdminShell>
  );
}
