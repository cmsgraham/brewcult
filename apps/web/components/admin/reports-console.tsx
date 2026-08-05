'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  REPORT_STATUSES,
  REPORT_STATUS_LABEL,
  adminClient,
  type ModerationReport,
  type ReportStatus,
} from '../../lib/admin-client';
import { Badge } from './badges';
import { ConfirmDialog } from './confirm-dialog';
import { ActionStatus, noteFromError, type ActionNote } from './feedback';
import { formatWhen } from './format';
import { ReasonField } from './reason-field';
import styles from './admin.module.css';

/**
 * Moderation queue (deliverable 5, second_draft §18).
 *
 * Tone rules taken from §18 and §9.7, and they are not decoration:
 *  - **Firm and procedural.** "Actioned" and "Dismissed", not "Banned!" or
 *    "Nothing to see here". The queue is a process, not a scoreboard.
 *  - **Never gloating.** No counters of how many people were actioned, no
 *    language that treats enforcement as a win. High-impact enforcement gets
 *    human review (§18.3); a UI that rewards volume works against that.
 *  - **Dismissing is a real outcome**, not a failure — reports made in good
 *    faith about things that turn out to be fine are the system working.
 *
 * Resolutions require a note. §18.3 lists appeals as first-class tooling, and an
 * appeal needs something to appeal against.
 */

type ListState =
  | { kind: 'loading' }
  | { kind: 'ready'; items: ModerationReport[]; nextCursor: string | null }
  | { kind: 'error'; message: string };

const NOT_BUILT =
  'The moderation queue is not switched on yet — it arrives with the operator API. Reports are still being accepted and none are being dropped.';

export function ReportsConsole() {
  const [status, setStatus] = useState<ReportStatus | ''>('open');
  const [cursors, setCursors] = useState<string[]>([]);
  const [list, setList] = useState<ListState>({ kind: 'loading' });
  const [note, setNote] = useState<ActionNote | null>(null);

  const [pending, setPending] = useState<{
    report: ModerationReport;
    resolution: 'actioned' | 'dismissed';
  } | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<ReactNode>(null);
  const [claiming, setClaiming] = useState<string | null>(null);

  const cursor = cursors.length > 0 ? (cursors[cursors.length - 1] ?? null) : null;
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = (requestId.current += 1);
    setList({ kind: 'loading' });
    try {
      const result = await adminClient.listReports({ status, cursor });
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

  async function claim(report: ModerationReport) {
    setClaiming(report.id);
    setNote(null);
    try {
      await adminClient.claimReport(report.id);
      setNote({
        tone: 'success',
        message: 'Claimed. It is on your name now — other moderators will see that.',
      });
      await load();
    } catch (error) {
      setNote(noteFromError(error, NOT_BUILT));
    } finally {
      setClaiming(null);
    }
  }

  function open(report: ModerationReport, resolution: 'actioned' | 'dismissed') {
    setPending({ report, resolution });
    setResolutionNote('');
    setDialogError(null);
    setNote(null);
  }

  function close() {
    setPending(null);
    setResolutionNote('');
    setDialogError(null);
  }

  async function run() {
    if (!pending) return;
    setBusy(true);
    setDialogError(null);
    try {
      await adminClient.resolveReport(pending.report.id, {
        resolution: pending.resolution,
        note: resolutionNote.trim(),
      });
      setNote({
        tone: 'success',
        message:
          pending.resolution === 'actioned'
            ? 'Recorded as actioned. The note is on the report and on the audit log.'
            : 'Recorded as dismissed. The reporter is told it was looked at.',
      });
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
  const noteGiven = resolutionNote.trim().length > 0;

  return (
    <div className="bc-stack">
      <ActionStatus note={note} />

      <div className={styles.filters}>
        <div className={styles.filter}>
          <label htmlFor="admin-report-status">Status</label>
          <select
            id="admin-report-status"
            className={styles.select}
            value={status}
            onChange={(event) => {
              setCursors([]);
              setStatus(event.target.value as ReportStatus | '');
            }}
          >
            <option value="">Everything</option>
            {REPORT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {REPORT_STATUS_LABEL[value]}
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
        <p className={styles.empty}>Loading reports…</p>
      ) : items.length === 0 ? (
        <div className="bc-panel">
          <p style={{ marginBottom: 0 }}>
            Nothing in this queue right now.
          </p>
        </div>
      ) : (
        <ul className={styles.queueGrid}>
          {items.map((report) => (
            <li key={report.id} className={styles.queueCard}>
              <h3>{report.reason}</h3>
              <p className={styles.queueMeta}>
                <Badge tone={report.status === 'open' ? 'strong' : 'quiet'}>
                  {REPORT_STATUS_LABEL[report.status]}
                </Badge>{' '}
                · {report.target_type} · reported {formatWhen(report.created_at, 'date unknown')}
              </p>
              {report.details ? <p>{report.details}</p> : null}
              <dl className={styles.definitions}>
                <dt>Target</dt>
                <dd>
                  {report.target_url ? (
                    <a href={report.target_url}>{report.target_type}</a>
                  ) : (
                    `${report.target_type} ${report.target_id}`
                  )}
                </dd>
                <dt>Claimed by</dt>
                <dd>{report.assignee ? `@${report.assignee.handle}` : 'Nobody yet'}</dd>
              </dl>
              {report.resolution_note ? (
                <p className={styles.queueMeta}>Resolution: {report.resolution_note}</p>
              ) : null}

              {report.status === 'open' || report.status === 'reviewing' ? (
                <div className={styles.rowActions}>
                  {report.assignee ? null : (
                    <button
                      type="button"
                      className={styles.smallButton}
                      onClick={() => void claim(report)}
                      disabled={claiming === report.id}
                    >
                      {claiming === report.id ? 'Claiming…' : 'Claim'}
                    </button>
                  )}
                  <button
                    type="button"
                    className={`${styles.smallButton} ${styles.destructive}`}
                    onClick={() => open(report, 'actioned')}
                  >
                    Record as actioned
                  </button>
                  <button
                    type="button"
                    className={styles.smallButton}
                    onClick={() => open(report, 'dismissed')}
                  >
                    Dismiss
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
            pending.resolution === 'actioned' ? 'Record this as actioned?' : 'Dismiss this report?'
          }
          consequence={
            pending.resolution === 'actioned' ? (
              <p style={{ marginBottom: 0 }}>
                The report closes as actioned and the note below becomes the record of why.
                Enforcement against the account — a restriction, a removal — is a separate,
                deliberate step; this only records the outcome of the review.
              </p>
            ) : (
              <p style={{ marginBottom: 0 }}>
                The report closes with no action against the account, and the person who
                reported it is told it was looked at. Dismissing is a normal outcome, not a
                verdict on the reporter.
              </p>
            )
          }
          confirmLabel={pending.resolution === 'actioned' ? 'Record as actioned' : 'Dismiss report'}
          destructive={pending.resolution === 'actioned'}
          confirmDisabled={!noteGiven}
          busy={busy}
          error={dialogError}
          onConfirm={() => void run()}
          onCancel={close}
        >
          <ReasonField
            id="admin-report-resolution"
            label="Resolution note"
            hint="What you found and what you did about it. Plain, factual, no commentary on the person — this is quoted in appeals."
            value={resolutionNote}
            onChange={setResolutionNote}
            required
          />
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
