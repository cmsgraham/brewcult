import { type Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EquipmentRequestsConsole } from '../../../components/admin/equipment-requests-console';
import { MfaInterstitial } from '../../../components/admin/gate';
import { AdminShell } from '../../../components/admin/shell';
import { adminGate } from '../_lib/guard';

export const metadata: Metadata = {
  title: 'Equipment requests · Operator console',
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = 'force-dynamic';

/** Catalogue proposals awaiting a person (0011, tier 2). */
export default async function AdminEquipmentRequestsPage() {
  const gate = await adminGate();
  if (gate.state === 'unavailable') notFound();
  if (gate.state === 'mfa-required') return <MfaInterstitial actor={gate.actor} />;

  return (
    <AdminShell
      current="equipment-requests"
      title="Equipment requests"
      lede="Somebody described gear the catalogue does not have. An assistant drafted an entry from it; the draft is a starting point, not an answer. Check the specs against the model you are actually looking at — a wrong burr size here reaches everyone's grind conversions."
      actor={gate.actor}
    >
      <EquipmentRequestsConsole />
    </AdminShell>
  );
}
