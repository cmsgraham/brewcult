'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { adminClient } from '../../lib/admin-client';
import type { EquipmentRequest } from '../../lib/equipment-client';
import { ConfirmDialog } from './confirm-dialog';
import { ActionStatus, noteFromError, type ActionNote } from './feedback';
import { formatWhen } from './format';
import { ReasonField } from './reason-field';
import styles from './admin.module.css';

/**
 * Catalogue proposals (0011, tier 2).
 *
 * ── WHY THE FORM IS EDITABLE ────────────────────────────────────────────────
 * The obvious build is two buttons: Approve, Reject. That turns the reviewer
 * into a rubber stamp for whatever the model said — and the model reasons from
 * its own knowledge, so it is occasionally confidently wrong about a burr
 * diameter. The catalogue drives grind-setting conversions, so that error would
 * outlive everyone's memory of it. The fields are pre-filled from the draft and
 * what POSTs is whatever the reviewer left in them. The API takes the
 * reviewer's values and never reads `ai_draft`, so the two agree.
 *
 * The original submission is shown NEXT TO the draft, never replaced by it: the
 * only way to catch a bad draft is to be able to see what it was made from.
 */

const CATEGORIES = ['brewer', 'grinder', 'kettle', 'scale', 'machine', 'accessory'] as const;
const GRIND_SCALES = ['stepped', 'stepless', 'rotational'] as const;

const NOT_BUILT =
  'The equipment request queue is not switched on yet. Submissions are still being recorded; nothing is lost.';

interface Draft {
  brand: string;
  name: string;
  category: string;
  grind_scale_type: string;
}

function draftFrom(request: EquipmentRequest): Draft {
  const ai = request.ai_draft;
  return {
    brand: ai?.brand ?? '',
    name: ai?.name ?? '',
    category: ai?.category ?? '',
    grind_scale_type: ai?.grind_scale_type ?? '',
  };
}

export function EquipmentRequestsConsole() {
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [items, setItems] = useState<EquipmentRequest[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [note, setNote] = useState<ActionNote | null>(null);

  const [edits, setEdits] = useState<Record<string, Draft>>({});
  const [pending, setPending] = useState<{ kind: 'approve' | 'reject'; request: EquipmentRequest } | null>(
    null,
  );
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<ReactNode>(null);

  const load = useCallback(async () => {
    setItems(null);
    setListError(null);
    try {
      const rows = await adminClient.listEquipmentRequests(status);
      setItems(rows);
      setEdits(Object.fromEntries(rows.map((row) => [row.id, draftFrom(row)])));
    } catch (error) {
      setListError(noteFromError(error, NOT_BUILT).message);
      setItems([]);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  function edit(id: string, field: keyof Draft, value: string) {
    setEdits((current) => ({
      ...current,
      [id]: { ...(current[id] ?? { brand: '', name: '', category: '', grind_scale_type: '' }), [field]: value },
    }));
  }

  async function run() {
    if (!pending) return;
    const { kind, request } = pending;
    setBusy(true);
    setDialogError(null);
    try {
      if (kind === 'approve') {
        const entry = edits[request.id];
        if (!entry) throw new Error('Nothing to approve.');
        await adminClient.approveEquipmentRequest(request.id, {
          brand: entry.brand.trim(),
          name: entry.name.trim(),
          category: entry.category,
          grind_scale_type: entry.category === 'grinder' ? entry.grind_scale_type || null : null,
        });
        setNote({
          tone: 'success',
          message: `${entry.brand} ${entry.name} is in the catalogue. Everyone can find it now.`,
        });
      } else {
        await adminClient.rejectEquipmentRequest(request.id, reason.trim());
        setNote({
          tone: 'success',
          message: 'Declined. The reason is shown to whoever submitted it.',
        });
      }
      setPending(null);
      setReason('');
      await load();
    } catch (error) {
      const failure = noteFromError(error);
      if (failure.mfa) {
        setNote(failure);
        setPending(null);
      } else {
        setDialogError(failure.message);
      }
    } finally {
      setBusy(false);
    }
  }

  const rejecting = pending?.kind === 'reject';
  const reasonGiven = reason.trim().length > 0;

  return (
    <div className="bc-stack">
      <ActionStatus note={note} />

      <div className={styles.filters}>
        <div className={styles.filter}>
          <label htmlFor="admin-request-status">Status</label>
          <select
            id="admin-request-status"
            className={styles.select}
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
          >
            <option value="pending">Waiting</option>
            <option value="approved">Approved</option>
            <option value="rejected">Declined</option>
          </select>
        </div>
      </div>

      {listError ? (
        <div className="bc-panel">
          <p style={{ marginBottom: 0 }}>{listError}</p>
        </div>
      ) : items === null ? (
        <p className={styles.empty}>Loading requests…</p>
      ) : items.length === 0 ? (
        <div className="bc-panel">
          <p style={{ marginBottom: 0 }}>
            {status === 'pending'
              ? 'Nothing waiting. An empty queue is the goal, not a bug.'
              : 'Nothing here.'}
          </p>
        </div>
      ) : (
        <ul className={styles.queueGrid}>
          {items.map((request) => {
            const entry = edits[request.id] ?? draftFrom(request);
            // The catalogue requires grinders to declare a scale (0003) — the
            // grind converter cannot answer without one. Enforcing it here means
            // the reviewer is told before they commit, not by a rejected POST.
            const ready =
              entry.brand.trim() !== '' &&
              entry.name.trim() !== '' &&
              entry.category !== '' &&
              (entry.category !== 'grinder' || entry.grind_scale_type !== '');
            return (
              <li key={request.id} className={styles.queueCard}>
                <h3>{entry.name.trim() || 'Unidentified'}</h3>
                <p className={styles.queueMeta}>
                  from {request.requester_handle ? `@${request.requester_handle}` : 'a deleted account'} ·{' '}
                  {formatWhen(request.created_at, 'date unknown')}
                  {request.ai_draft?.confidence ? ` · draft confidence: ${request.ai_draft.confidence}` : ''}
                </p>

                {/* What they actually typed, kept verbatim and shown FIRST. A
                    draft can only be checked against its input. */}
                <p className={styles.submission}>{request.submitted_text}</p>

                {request.image_url ? (
                  // A plain <img>: next/image would route an operator-only photo
                  // through the optimiser for an audience of a handful of staff.
                  <img
                    className={styles.submissionImage}
                    src={request.image_url}
                    alt="Submitted photo of the equipment"
                    loading="lazy"
                  />
                ) : null}

                {request.ai_error ? (
                  <p className={styles.queueMeta}>
                    No draft — the assistant failed: {request.ai_error}. Fill this in yourself.
                  </p>
                ) : request.ai_draft?.notes ? (
                  <p className={styles.queueMeta}>Draft notes: {request.ai_draft.notes}</p>
                ) : null}

                {request.status === 'pending' ? (
                  <>
                    <div className={styles.draftGrid}>
                      <span className="bc-field">
                        <label htmlFor={`brand-${request.id}`}>Brand</label>
                        <input
                          id={`brand-${request.id}`}
                          className="bc-input"
                          value={entry.brand}
                          onChange={(event) => edit(request.id, 'brand', event.target.value)}
                        />
                      </span>
                      <span className="bc-field">
                        <label htmlFor={`name-${request.id}`}>Model</label>
                        <input
                          id={`name-${request.id}`}
                          className="bc-input"
                          value={entry.name}
                          onChange={(event) => edit(request.id, 'name', event.target.value)}
                        />
                      </span>
                      <span className="bc-field">
                        <label htmlFor={`category-${request.id}`}>Type</label>
                        <select
                          id={`category-${request.id}`}
                          className={styles.select}
                          value={entry.category}
                          onChange={(event) => edit(request.id, 'category', event.target.value)}
                        >
                          <option value="">Choose…</option>
                          {CATEGORIES.map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                      </span>
                      {entry.category === 'grinder' ? (
                        <span className="bc-field">
                          <label htmlFor={`scale-${request.id}`}>Grind scale (required)</label>
                          <select
                            id={`scale-${request.id}`}
                            className={styles.select}
                            value={entry.grind_scale_type}
                            onChange={(event) => edit(request.id, 'grind_scale_type', event.target.value)}
                          >
                            <option value="">Choose…</option>
                            {GRIND_SCALES.map((value) => (
                              <option key={value} value={value}>
                                {value}
                              </option>
                            ))}
                          </select>
                        </span>
                      ) : null}
                    </div>

                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className={styles.smallButton}
                        disabled={!ready}
                        onClick={() => {
                          setPending({ kind: 'approve', request });
                          setDialogError(null);
                          setNote(null);
                        }}
                      >
                        Add to catalogue
                      </button>
                      <button
                        type="button"
                        className={`${styles.smallButton} ${styles.destructive}`}
                        onClick={() => {
                          setPending({ kind: 'reject', request });
                          setReason('');
                          setDialogError(null);
                          setNote(null);
                        }}
                      >
                        Decline
                      </button>
                    </div>
                  </>
                ) : request.decision_note ? (
                  <p className={styles.queueMeta}>Decision noted: {request.decision_note}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {pending ? (
        <ConfirmDialog
          open
          title={
            rejecting
              ? 'Decline this suggestion?'
              : `Add ${edits[pending.request.id]?.brand} ${edits[pending.request.id]?.name} to the catalogue?`
          }
          consequence={
            rejecting ? (
              <p style={{ marginBottom: 0 }}>
                Nothing is added and the person is told why. Anything they already recorded against
                their own account is untouched.
              </p>
            ) : (
              <p style={{ marginBottom: 0 }}>
                This becomes a <strong>public catalogue entry</strong> that everyone can select, and
                it feeds grind-setting conversions. Check the specs are right for this exact model
                rather than a variant — a wrong number here is worse than a missing one.
              </p>
            )
          }
          confirmLabel={rejecting ? 'Decline' : 'Add to catalogue'}
          destructive={rejecting}
          confirmDisabled={rejecting && !reasonGiven}
          busy={busy}
          error={dialogError}
          onConfirm={() => void run()}
          onCancel={() => {
            setPending(null);
            setReason('');
            setDialogError(null);
          }}
        >
          {rejecting ? (
            <ReasonField
              id="admin-request-reason"
              label="Why this is being declined"
              hint="The person who suggested it reads this. Say what was wrong — a duplicate, not enough detail, not coffee equipment."
              value={reason}
              onChange={setReason}
              required
            />
          ) : null}
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
