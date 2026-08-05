'use client';

import { useEffect, useState, type ClipboardEvent } from 'react';
import { isApiError } from '../../lib/api';
import {
  fetchMyEquipmentRequests,
  submitEquipmentRequest,
  type EquipmentRequest,
} from '../../lib/equipment-client';
import {
  IMAGE_ACCEPT,
  PHOTO_PRIVACY_NOTE,
  formatBytes,
  uploadMedia,
  validateImageFile,
} from '../../lib/media-client';
import { Alert } from '../ui/alert';

/**
 * A clipboard image arrives as a nameless Blob. The upload sends a filename, and
 * "upload" for every screenshot anybody ever pastes is not a filename — so one
 * is made here, with the extension the blob's own type implies.
 */
function fileFromClipboard(blob: Blob): File {
  const extension = (blob.type.split('/')[1] ?? 'png').replace('jpeg', 'jpg');
  return new File([blob], `pasted-photo.${extension}`, {
    type: blob.type || 'image/png',
  });
}

/**
 * Propose something for the SHARED catalogue.
 *
 * Since 0013 the assistant decides, so this is usually instant too: describe it,
 * and if the assistant recognises the product it is published and lands on your
 * shelf in one step. What the copy must NOT do is promise that, because the
 * honest answer depends on whether the model knew what it was looking at —
 * anything it is unsure about still waits for a person.
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
  const [preview, setPreview] = useState<string | null>(null);
  const [requests, setRequests] = useState<EquipmentRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * What actually happened, rather than "sent". The two outcomes are different
   * enough that one message for both would be wrong in one of the cases.
   */
  const [outcome, setOutcome] = useState<{ kind: 'published' | 'queued'; label: string } | null>(
    null,
  );
  /**
   * `navigator.clipboard.read()` is Chromium-and-Safari only; Firefox has no
   * scripted clipboard read at all. Detecting once on mount means the button
   * simply is not offered where it could only fail — and the Ctrl+V route, which
   * works everywhere, is described either way.
   */
  const [canReadClipboard, setCanReadClipboard] = useState(false);

  useEffect(() => {
    setCanReadClipboard(typeof navigator !== 'undefined' && typeof navigator.clipboard?.read === 'function');
  }, []);

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

  // One object URL at a time, revoked when it is replaced or the form goes away.
  // Without this every paste leaks the previous image for the life of the tab.
  useEffect(() => {
    if (!photo) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  /** Accept a photo from any of the three routes, or say why not. */
  function attach(file: File | null): void {
    if (!file) return;
    const complaint = validateImageFile(file);
    if (complaint) {
      setError(complaint);
      return;
    }
    setError(null);
    setPhoto(file);
  }

  /**
   * Ctrl+V anywhere in the form.
   *
   * Pasted TEXT is left entirely alone — the textarea already does the right
   * thing with it, and intercepting would break the ordinary case to serve the
   * unusual one. Only an image is claimed, and only then is the default
   * prevented, so a screenshot does not also dump a filename into the box.
   */
  function onPaste(event: ClipboardEvent<HTMLDivElement>): void {
    const item = Array.from(event.clipboardData?.items ?? []).find((entry) =>
      entry.type.startsWith('image/'),
    );
    if (!item) return;
    const file = item.getAsFile();
    if (!file) return;
    event.preventDefault();
    attach(file);
  }

  /** The button, for people who do not think in keyboard shortcuts. */
  async function pasteFromClipboard(): Promise<void> {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((candidate) => candidate.startsWith('image/'));
        if (!type) continue;
        attach(fileFromClipboard(await item.getType(type)));
        return;
      }
      setError('There is no image on the clipboard — copy one first, or choose a file.');
    } catch {
      // Denied permission, an empty clipboard, or a browser that changed its
      // mind about supporting this. Ctrl+V still works, so say so.
      setError('The browser would not let us read the clipboard. Press Ctrl+V (or ⌘V) instead.');
    }
  }

  async function submit(): Promise<void> {
    const text = description.trim();
    if (text === '') return;
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      // The photo goes through the media pipeline FIRST — sniffed, re-encoded
      // and EXIF-stripped — so nothing downstream ever sees a raw upload.
      let mediaId: string | undefined;
      if (photo) {
        const asset = await uploadMedia(photo, 'equipment_submission');
        mediaId = asset.id;
      }
      const items = await submitEquipmentRequest({
        description: text,
        ...(mediaId ? { image_media_id: mediaId } : {}),
      });
      setRequests(items);

      // The newest row is this submission; its status says which way it went.
      const mine = items[0];
      const draft = mine?.ai_draft;
      setOutcome({
        kind: mine?.status === 'approved' ? 'published' : 'queued',
        label:
          [draft?.brand, draft?.name].filter(Boolean).join(' ').trim() ||
          text.slice(0, 40),
      });
      setDescription('');
      setPhoto(null);
      setOpen(false);
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
      {outcome ? (
        <Alert
          tone={outcome.kind === 'published' ? 'success' : 'info'}
          title={
            outcome.kind === 'published'
              ? `${outcome.label} is in the catalogue.`
              : 'Thanks — that is with us.'
          }
        >
          {outcome.kind === 'published'
            ? 'It has been added to your equipment too, so you can use it straight away.'
            : 'The assistant was not sure enough to add it, so a person will look. Anything you already recorded yourself keeps working in the meantime.'}
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
        <div className="bc-panel bc-stack" onPaste={onPaste}>
          <p style={{ marginBottom: 0 }}>
            Describe it, or paste the manufacturer&rsquo;s description. If the assistant
            recognises the product it is added to the catalogue and to your equipment right
            away. Anything it is unsure about waits for a person instead of guessing.
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

            {photo && preview ? (
              <span className="bc-photo-chosen">
                {/* A pasted screenshot has no filename worth reading, so the
                    picture itself is the confirmation that the right thing
                    landed. */}
                <img className="bc-photo-chosen__thumb" src={preview} alt="The photo you attached" />
                <span className="bc-photo-chosen__text">
                  <span>{photo.name}</span>
                  <span className="bc-muted">{formatBytes(photo.size)}</span>
                </span>
                <button
                  type="button"
                  className="bc-button bc-button--quiet"
                  disabled={busy}
                  onClick={() => setPhoto(null)}
                >
                  Remove
                </button>
              </span>
            ) : (
              <>
                <input
                  id="request-photo"
                  className="bc-input"
                  type="file"
                  accept={IMAGE_ACCEPT}
                  disabled={busy}
                  onChange={(event) => attach(event.target.files?.[0] ?? null)}
                />
                <span className="bc-photo-paste">
                  {canReadClipboard ? (
                    <button
                      type="button"
                      className="bc-button bc-button--quiet"
                      disabled={busy}
                      onClick={() => void pasteFromClipboard()}
                    >
                      Paste from clipboard
                    </button>
                  ) : null}
                  <span className="bc-muted" style={{ fontSize: '0.85rem' }}>
                    {canReadClipboard
                      ? 'Or press Ctrl+V (⌘V) anywhere in this box.'
                      : 'Copy a screenshot, then press Ctrl+V (⌘V) anywhere in this box.'}
                  </span>
                </span>
              </>
            )}

            <span className="bc-muted" style={{ fontSize: '0.85rem' }}>
              {PHOTO_PRIVACY_NOTE}
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
