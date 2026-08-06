import { type Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  AuditFilters,
  AuditPager,
  AuditTable,
  type AuditFilterValues,
} from '../../../../components/admin/audit-view';
import { MfaInterstitial } from '../../../../components/admin/gate';
import { SessionRestoreScreen } from '../../../../components/session-restore-screen';
import { AdminShell } from '../../../../components/admin/shell';
import { describeAdminError, type AuditEntry } from '../../../../lib/admin-client';
import { adminGate, serverAdminClient } from '../_lib/guard';

export const metadata: Metadata = {
  title: 'Audit log · Operator console',
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = 'force-dynamic';

const NOT_BUILT =
  'The audit log viewer is not switched on yet — it arrives with the operator API. Entries are still being written; this is only the window onto them.';

/** First `?key=` value, as a trimmed string. */
function one(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return (value[0] ?? '').trim();
  return (value ?? '').trim();
}

/**
 * Audit log viewer (deliverable 6).
 *
 * Fully server-rendered, no client JavaScript: this is the page people open
 * during an incident, when "does it work with a flaky connection and a locked-
 * down browser" stops being a hypothetical. It is also strictly read-only —
 * EF §3.7 puts the log in storage the app can write but not modify, and the UI
 * offers no affordance that would suggest otherwise.
 */
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const gate = await adminGate();
  // Not "no such page" — "we could not read your session". A 404 here sends an
  // operator looking for a deleted feature; the truth is an expired cookie.
  if (gate.state === 'restore') return <SessionRestoreScreen next="/admin/audit" />;
  if (gate.state === 'unavailable') notFound();
  if (gate.state === 'mfa-required') return <MfaInterstitial actor={gate.actor} />;

  const params = await searchParams;
  const values: AuditFilterValues = {
    actor: one(params['actor']),
    action: one(params['action']),
    target_type: one(params['target_type']),
  };
  const cursor = one(params['cursor']);

  let entries: AuditEntry[] = [];
  let nextCursor: string | null = null;
  let failure: string | null = null;

  try {
    const result = await serverAdminClient.listAudit({ ...values, cursor });
    entries = result.items;
    nextCursor = result.next_cursor ?? null;
  } catch (error) {
    failure = describeAdminError(error, NOT_BUILT);
  }

  return (
    <AdminShell
      current="audit"
      title="Audit log"
      lede="Every staff action, in the order it happened, written by the API and never edited afterwards. Yours are in here too."
      actor={gate.actor}
    >
      <AuditFilters values={values} />

      {failure === null ? (
        <>
          <AuditTable entries={entries} />
          <AuditPager values={values} nextCursor={nextCursor} onFirstPage={cursor === ''} />
        </>
      ) : (
        <div className="bc-panel">
          <p style={{ marginBottom: 0 }}>{failure}</p>
        </div>
      )}
    </AdminShell>
  );
}
