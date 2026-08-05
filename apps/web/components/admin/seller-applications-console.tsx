'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_LABEL,
  ROLE_CONSEQUENCE,
  adminClient,
  type SellerApplication,
  type SellerApplicationStatus,
} from '../../lib/admin-client';
import { Badge } from './badges';
import { ConfirmDialog } from './confirm-dialog';
import { ActionStatus, noteFromError, type ActionNote } from './feedback';
import { formatWhen } from './format';
import { ReasonField } from './reason-field';
import styles from './admin.module.css';

/**
 * Seller application queue (deliverable 4).
 *
 * Approving is a **permission grant**, not a rubber stamp — it hands over the
 * `seller_owner` role and everything that comes with it (EF §3.2: permission
 * grants are audit-logged). The confirmation says so in as many words, because
 * "Approve" on its own reads like clearing a notification.
 *
 * Declining requires a reason. Someone put work into the application; a decision
 * with no reason attached is not a decision an appeal can be built on
 * (second_draft §18.3 — appeals are part of the tooling).
 */

type Decision = 'approve' | 'reject';

type ListState =
  | { kind: 'loading' }
  | { kind: 'ready'; items: SellerApplication[]; nextCursor: string | null }
  | { kind: 'error'; message: string };

const NOT_BUILT =
  'The seller application queue is not switched on yet — it arrives with the operator API. Applications are still being recorded; nothing is lost.';

export function SellerApplicationsConsole() {
  const [status, setStatus] = useState<SellerApplicationStatus | ''>('pending');
  const [cursors, setCursors] = useState<string[]>([]);
  const [list, setList] = useState<ListState>({ kind: 'loading' });
  const [note, setNote] = useState<ActionNote | null>(null);

  const [pending, setPending] = useState<{ decision: Decision; application: SellerApplication } | null>(
    null,
  );
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<ReactNode>(null);

  const cursor = cursors.length > 0 ? (cursors[cursors.length - 1] ?? null) : null;
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = (requestId.current += 1);
    setList({ kind: 'loading' });
    try {
      const result = await adminClient.listSellerApplications({ status, cursor });
      if (id !== requestId.current) return;
      setList({ kind: 'ready', items: result.items, nextCursor: result.next_cursor ?? null });
    } catch (error) {
      if (id !== requestId.current) return;
      setList({ kind: 'error', message: noteFromError(error, NOT_BUILT).message });
    }
  }, [status, cursor]);

  useEffect(() => {
    void load();
  }, [load]);

  function open(decision: Decision, application: SellerApplication) {
    setPending({ decision, application });
    setReason('');
    setDialogError(null);
    setNote(null);
  }

  function close() {
    setPending(null);
    setReason('');
    setDialogError(null);
  }

  async function run() {
    if (!pending) return;
    const { decision, application } = pending;
    setBusy(true);
    setDialogError(null);
    try {
      if (decision === 'approve') {
        await adminClient.approveApplication(application.id, reason.trim());
        setNote({
          tone: 'success',
          message: `${application.business_name} is approved and now holds the seller owner role.`,
        });
      } else {
        await adminClient.rejectApplication(application.id, reason.trim());
        setNote({
          tone: 'success',
          message: `${application.business_name} has been declined. The reason is on the record and can be quoted in an appeal.`,
        });
      }
      close();
      await load();
    } catch (error) {
      const failure = noteFromError(error);
      if (failure.mfa) {
        setNote(failure);
        close();
      } else {
        setDialogError(failure.message);
      }
    } finally {
      setBusy(false);
    }
  }

  const items = list.kind === 'ready' ? list.items : [];
  const rejecting = pending?.decision === 'reject';
  const reasonGiven = reason.trim().length > 0;

  return (
    <div className="bc-stack">
      <ActionStatus note={note} />

      <div className={styles.filters}>
        <div className={styles.filter}>
          <label htmlFor="admin-application-status">Status</label>
          <select
            id="admin-application-status"
            className={styles.select}
            value={status}
            onChange={(event) => {
              setCursors([]);
              setStatus(event.target.value as SellerApplicationStatus | '');
            }}
          >
            <option value="">Everything</option>
            {APPLICATION_STATUSES.map((value) => (
              <option key={value} value={value}>
                {APPLICATION_STATUS_LABEL[value]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {list.kind === 'error' ? (
        <div className="bc-panel">
          <p style={{ marginBottom: 0 }}>{list.message}</p>
        </div>
      ) : list.kind === 'loading' ? (
        <p className={styles.empty}>Loading applications…</p>
      ) : items.length === 0 ? (
        <div className="bc-panel">
          <p style={{ marginBottom: 0 }}>
            Nothing waiting. An empty queue is the goal, not a bug.
          </p>
        </div>
      ) : (
        <ul className={styles.queueGrid}>
          {items.map((application) => (
            <li key={application.id} className={styles.queueCard}>
              <h3>{application.business_name}</h3>
              <p className={styles.queueMeta}>
                <Badge tone={application.status === 'pending' ? 'strong' : 'quiet'}>
                  {APPLICATION_STATUS_LABEL[application.status]}
                </Badge>{' '}
                · applied {formatWhen(application.created_at, 'date unknown')}
              </p>
              <dl className={styles.definitions}>
                <dt>Applicant</dt>
                <dd>{application.applicant ? `@${application.applicant.handle}` : 'Unknown'}</dd>
                {application.country ? (
                  <>
                    <dt>Country</dt>
                    <dd>{application.country}</dd>
                  </>
                ) : null}
                {application.website ? (
                  <>
                    <dt>Website</dt>
                    <dd>
                      <a href={application.website} rel="noreferrer nofollow" target="_blank">
                        {application.website}
                      </a>
                    </dd>
                  </>
                ) : null}
              </dl>
              {application.notes ? <p>{application.notes}</p> : null}
              {application.decision_reason ? (
                <p className={styles.queueMeta}>Decision noted: {application.decision_reason}</p>
              ) : null}

              {application.status === 'pending' ? (
                <div className={styles.rowActions}>
                  <button
                    type="button"
                    className={styles.smallButton}
                    onClick={() => open('approve', application)}
                  >
                    Approve
                    <span className="bc-visually-hidden"> {application.business_name}</span>
                  </button>
                  <button
                    type="button"
                    className={`${styles.smallButton} ${styles.destructive}`}
                    onClick={() => open('reject', application)}
                  >
                    Decline
                    <span className="bc-visually-hidden"> {application.business_name}</span>
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <div className={styles.pager}>
        <button
          type="button"
          className="bc-button bc-button--quiet"
          disabled={cursors.length === 0 || list.kind === 'loading'}
          onClick={() => setCursors((stack) => stack.slice(0, -1))}
        >
          Previous page
        </button>
        <button
          type="button"
          className="bc-button bc-button--quiet"
          disabled={list.kind !== 'ready' || list.nextCursor === null}
          onClick={() =>
            setCursors((stack) =>
              list.kind === 'ready' && list.nextCursor ? [...stack, list.nextCursor] : stack,
            )
          }
        >
          Next page
        </button>
        <p className={styles.pagerNote}>Page {cursors.length + 1}</p>
      </div>

      {pending ? (
        <ConfirmDialog
          open
          title={
            rejecting
              ? `Decline ${pending.application.business_name}?`
              : `Approve ${pending.application.business_name} as a seller?`
          }
          consequence={
            rejecting ? (
              <p style={{ marginBottom: 0 }}>
                The application is closed and the applicant is told. They can apply again once
                whatever is missing is sorted out — so say what that is.
              </p>
            ) : (
              <p style={{ marginBottom: 0 }}>
                This grants the <strong>seller owner</strong> role to{' '}
                {pending.application.applicant
                  ? `@${pending.application.applicant.handle}`
                  : 'the applicant'}
                . {ROLE_CONSEQUENCE.seller_owner} The grant is audit-logged under your name.
              </p>
            )
          }
          confirmLabel={rejecting ? 'Decline application' : 'Approve and grant seller access'}
          destructive={rejecting}
          confirmDisabled={rejecting && !reasonGiven}
          busy={busy}
          error={dialogError}
          onConfirm={() => void run()}
          onCancel={close}
        >
          <ReasonField
            id="admin-application-reason"
            label={rejecting ? 'Why this is being declined' : 'Note for the record'}
            hint={
              rejecting
                ? 'Concrete and procedural — what was missing, and what would fix it. This is what an appeal gets read against.'
                : 'Anything the next operator should know about this decision.'
            }
            value={reason}
            onChange={setReason}
            required={rejecting}
          />
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
