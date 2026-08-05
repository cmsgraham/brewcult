'use client';

import { useEffect, useState } from 'react';
import { isApiError } from '../../lib/api';
import {
  fetchMyEquipmentRequests,
  submitEquipmentRequest,
  type EquipmentRequest,
} from '../../lib/equipment-client';
import { uploadMedia } from '../../lib/media-client';
import { Alert } from '../ui/alert';

/**
 * Propose something for the SHARED catalogue.
 *
 * Deliberately separate from "add it to my equipment", which is instant and
 * private. This one waits for a person, and the form says so plainly — a
 * request that silently queues, with no sense that a human is involved, reads
 * as a broken form rather than a considered process.
 *
 * ── WHY NO URL FIELD ────────────────────────────────────────────────────────
 * The obvious version is "paste a link and we read it". Fetching a URL the
 * submitter chose, from inside our network, is server-side request forgery by
 * construction. Pasting the text instead means that whole class of bug never
 * exists, and the assistant already knows most of this equipment anyway.
 */
export function EquipmentRequestForm() {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [requests, setRequests] = useState<EquipmentRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchMyEquipmentRequests()
      .then((items) => {
        if (!cancelled) setRequests(items);
      })
      .catch(() => undefined); // a missing history is not worth an error banner
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(): Promise<void> {
    const text = description.trim();
    if (text === '') return;
    setBusy(true);
    setError(null);
    try {
      // The photo goes through the media pipeline FIRST — sniffed, re-encoded
      // and EXIF-stripped — so nothing downstream ever sees a raw upload.
      let mediaId: string | undefined;
      if (photo) {
        const asset = await uploadMedia(photo, 'equipment_image');
        mediaId = asset.id;
      }
      setRequests(
        await submitEquipmentRequest({
          description: text,
          ...(mediaId ? { image_media_id: mediaId } : {}),
        }),
      );
      setDescription('');
      setPhoto(null);
      setOpen(false);
      setSent(true);
    } catch (failure) {
      setError(
        isApiError(failure)
          ? failure.userMessage
          : 'That did not send. Try again in a moment.',
      );
    } finally {
      setBusy(false);
    }
  }

  const pending = requests.filter((r) => r.status === 'pending');

  return (
    <div className="bc-stack">
      {error ? <Alert tone="error">{error}</Alert> : null}
      {sent ? (
        <Alert tone="success" title="Thanks — that is with us.">
          Somebody will look at it. If it is added you will find it in search, and anything
          you already recorded yourself keeps working in the meantime.
        </Alert>
      ) : null}

      {!open ? (
        <p className="bc-muted" style={{ fontSize: '0.9rem' }}>
          Think it belongs in the shared catalogue?{' '}
          <button type="button" className="bc-link-button" onClick={() => setOpen(true)}>
            Suggest it
          </button>
          {pending.length > 0 ? ` — you have ${pending.length} awaiting review.` : ''}
        </p>
      ) : (
        <div className="bc-panel bc-stack">
          <p style={{ marginBottom: 0 }}>
            Describe it, or paste the manufacturer&rsquo;s description. An assistant drafts an
            entry from it and <strong>a person checks that draft</strong> before anything is
            added — so specs are right rather than fast.
          </p>

          <span className="bc-field">
            <label className="bc-kit__label" htmlFor="request-description">
              What is it?
            </label>
            <textarea
              id="request-description"
              className="bc-input"
              rows={4}
              maxLength={4000}
              placeholder="e.g. Option-O Lagom P100 — 64mm flat burr single-dose grinder, stepless…"
              value={description}
              disabled={busy}
              onChange={(event) => setDescription(event.target.value)}
            />
          </span>

          <span className="bc-field">
            <label className="bc-kit__label" htmlFor="request-photo">
              Photo <span className="bc-muted">(optional)</span>
            </label>
            <input
              id="request-photo"
              className="bc-input"
              type="file"
              accept="image/*"
              disabled={busy}
              onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
            />
            <span className="bc-muted" style={{ fontSize: '0.85rem' }}>
              Location data is stripped from photos when they upload.
            </span>
          </span>

          <div className="bc-actions" style={{ marginTop: 0 }}>
            <button
              type="button"
              className="bc-button"
              disabled={busy || description.trim() === ''}
              onClick={() => void submit()}
            >
              {busy ? 'Sending…' : 'Send suggestion'}
            </button>
            <button
              type="button"
              className="bc-button bc-button--quiet"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {requests.length > 0 ? (
        <details className="bc-kit__history">
          <summary>Your suggestions ({requests.length})</summary>
          <ul className="bc-kit">
            {requests.map((request) => (
              <li key={request.id} className="bc-kit__row">
                <span className="bc-kit__text">
                  <span className="bc-kit__name">
                    {request.ai_draft?.name
                      ? [request.ai_draft.brand, request.ai_draft.name].filter(Boolean).join(' ')
                      : request.submitted_text.slice(0, 60)}
                    <span className="bc-kit__badge bc-kit__badge--quiet">{request.status}</span>
                  </span>
                  {request.decision_note ? (
                    <span className="bc-muted bc-kit__meta">{request.decision_note}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
