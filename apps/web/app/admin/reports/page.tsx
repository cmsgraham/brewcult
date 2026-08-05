import { type Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MfaInterstitial } from '../../../components/admin/gate';
import { ReportsConsole } from '../../../components/admin/reports-console';
import { AdminShell } from '../../../components/admin/shell';
import { adminGate } from '../_lib/guard';

export const metadata: Metadata = {
  title: 'Reports · Operator console',
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = 'force-dynamic';

/**
 * Moderation queue (deliverable 5, second_draft §18).
 *
 * The copy through this screen is firm and procedural on purpose: claim it,
 * review it, record what you found. Dismissing is a normal outcome. Nothing here
 * counts enforcement or celebrates it.
 */
export default async function AdminReportsPage() {
  const gate = await adminGate();
  if (gate.state === 'unavailable') notFound();
  if (gate.state === 'mfa-required') return <MfaInterstitial actor={gate.actor} />;

  return (
    <AdminShell
      current="reports"
      title="Reports"
      lede="Claim one before you work it, so two people are not reviewing the same thing. Every resolution needs a note — it is what an appeal gets read against."
      actor={gate.actor}
    >
      <ReportsConsole />
    </AdminShell>
  );
}
