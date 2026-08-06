'use client';

import { useEffect, useRef, useState, type ClipboardEvent } from 'react';
import { isApiError } from '../../lib/api';
import {
  addToShelf,
  fetchShelf,
  finishBag,
  removeFromShelf,
  submitCoffee,
  type CoffeeRequest,
  type ShelfCoffee,
} from '../../lib/coffee-shelf-client';
import {
  IMAGE_ACCEPT,
  PHOTO_PRIVACY_NOTE,
  formatBytes,
  uploadMedia,
  validateImageFile,
} from '../../lib/media-client';
import { Alert } from '../ui/alert';

/**
 * Add a coffee by photographing the bag.
 *
 * ── WHY THE PHOTO IS THE PRIMARY INPUT, UNLIKE EQUIPMENT ────────────────────
 * The equipment form is text-first because the assistant is RECALLING a product
 * it knows. A bag roasted last week by a four-person roastery is something no
 * model has heard of — but the bag prints its own facts. So here the photo is
 * the submission and the text box is the fallback, which is the opposite way
 * round, and the copy says so.
 *
 * ── WHAT LANDS WHERE ────────────────────────────────────────────────────────
 * Every submission puts the bag on YOUR shelf, immediately, whether or not the
 * catalogue gets a row. That is the half you need to log a brew tonight, and
 * making it wait on anything would be the gatekeeping the product rules out.
 */
function fileFromClipboard(blob: Blob): File {
  const extension = (blob.type.split('/')[1] ?? 'png').replace('jpeg', 'jpg');
  return new File([blob], `bag-photo.${extension}`, { type: blob.type || 'image/png' });
}

/**
 * Two slots, both visible from the start. Revealing the second only after the
 * first is filled would hide the fact that the back is wanted at all — and the
 * back is where the roast date lives.
 */
const SLOTS = [
  {
    id: 'bag-photo-front',
    label: 'Front of the bag',
    optional: false,
    hint: 'The roaster and the name of the coffee.',
  },
  {
    id: 'bag-photo-back',
    label: 'Back of the bag',
    optional: true,
    hint: 'Roast date, process, weight — whatever is printed there.',
  },
] as const;

type Outcome =
  | { kind: 'published'; label: string }
  | { kind: 'shelved'; label: string }
  | { kind: 'rejected'; why: string };

export function AddCoffee({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState(false);
  const [description, setDescription] = useState('');
  const [roaster, setRoaster] = useState('');
  const [name, setName] = useState('');
  /**
   * The sides of one bag. The front carries the roaster and the coffee; the
   * back carries the roast date, the process and the weight — which is why one
   * photo was the wrong number, and why both slots are shown from the start
   * rather than revealed after the first is filled.
   */
  const [photos, setPhotos] = useState<(File | null)[]>([null, null]);
  const [previews, setPreviews] = useState<(string | null)[]>([null, null]);
  const [shelf, setShelf] = useState<ShelfCoffee[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [canReadClipboard, setCanReadClipboard] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCanReadClipboard(
      typeof navigator !== 'undefined' && typeof navigator.clipboard?.read === 'function',
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchShelf()
      .then((items) => {
        if (!cancelled) setShelf(items);
      })
      .catch(() => undefined); // signed out, or not built yet — not a banner
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const urls = photos.map((file) => (file ? URL.createObjectURL(file) : null));
    setPreviews(urls);
    // Revoked together, so replacing one slot cannot leak the other's blob for
    // the life of the tab.
    return () => {
      for (const url of urls) if (url) URL.revokeObjectURL(url);
    };
  }, [photos]);

  function attach(file: File | null, slot: number): void {
    if (!file) return;
    const complaint = validateImageFile(file);
    if (complaint) {
      setError(complaint);
      return;
    }
    setError(null);
    setPhotos((current) => current.map((existing, index) => (index === slot ? file : existing)));
  }

  /** Where a pasted image goes: the first empty slot, front before back. */
  const nextEmptySlot = (): number => {
    const index = photos.findIndex((file) => file === null);
    return index === -1 ? 0 : index;
  };

  function onPaste(event: ClipboardEvent<HTMLDivElement>): void {
    const item = Array.from(event.clipboardData?.items ?? []).find((entry) =>
      entry.type.startsWith('image/'),
    );
    if (!item) return;
    const file = item.getAsFile();
    if (!file) return;
    event.preventDefault();
    attach(file, nextEmptySlot());
  }

  async function pasteFromClipboard(): Promise<void> {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((candidate) => candidate.startsWith('image/'));
        if (!type) continue;
        attach(fileFromClipboard(await item.getType(type)), nextEmptySlot());
        return;
      }
      setError('There is no image on the clipboard — copy one first, or choose a file.');
    } catch {
      setError('The browser would not let us read the clipboard. Press Ctrl+V (or ⌘V) instead.');
    }
  }

  function reset(): void {
    setDescription('');
    setRoaster('');
    setName('');
    setPhotos([null, null]);
    setOpen(false);
    setManual(false);
  }

  /** The photo path: the assistant reads the label. */
  async function submitPhoto(): Promise<void> {
    const text = description.trim();
    const chosen = photos.filter((file): file is File => file !== null);
    if (chosen.length === 0 && text === '') return;
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      // Uploaded in order, so `position` in the request matches what they saw:
      // slot one is whatever they put in slot one.
      const mediaIds: string[] = [];
      for (const file of chosen) {
        const asset = await uploadMedia(file, 'equipment_submission');
        mediaIds.push(asset.id);
      }
      const items = await submitCoffee({
        ...(text ? { description: text } : {}),
        ...(mediaIds.length > 0 ? { image_media_ids: mediaIds } : {}),
      });
      setShelf(await fetchShelf());
      setOutcome(describe(items[0]));
      reset();
    } catch (failure) {
      setError(
        isApiError(failure) ? failure.userMessage : 'That did not send. Try again in a moment.',
      );
    } finally {
      setBusy(false);
    }
  }

  /** The typed path: straight onto the shelf, no assistant involved. */
  async function submitManual(): Promise<void> {
    if (name.trim() === '') return;
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      setShelf(
        await addToShelf({
          name: name.trim(),
          ...(roaster.trim() ? { roaster: roaster.trim() } : {}),
        }),
      );
      setOutcome({
        kind: 'shelved',
        label: [roaster.trim(), name.trim()].filter(Boolean).join(' '),
      });
      reset();
    } catch (failure) {
      setError(
        isApiError(failure) ? failure.userMessage : 'That did not save. Try again in a moment.',
      );
    } finally {
      setBusy(false);
    }
  }

  const open_ = shelf.filter((bag) => bag.finished_at === null);

  return (
    <div className="bc-stack">
      {error ? <Alert tone="error">{error}</Alert> : null}
      {outcome ? <OutcomeNote outcome={outcome} /> : null}

      {!open ? (
        <div className="bc-actions" style={{ marginTop: 0 }}>
          <button type="button" className="bc-button" onClick={() => setOpen(true)}>
            Add a coffee
          </button>
          {!compact && open_.length > 0 ? (
            <span className="bc-muted" style={{ fontSize: '0.9rem', alignSelf: 'center' }}>
              {open_.length} open {open_.length === 1 ? 'bag' : 'bags'} on your shelf
            </span>
          ) : null}
        </div>
      ) : (
        <div className="bc-panel bc-stack" onPaste={onPaste}>
          {!manual ? (
            <>
              <p style={{ marginBottom: 0 }}>
                Photograph the bag — the label has everything on it. Both sides help: the front
                names the roaster and the coffee, the back usually carries the roast date and the
                process. The assistant reads them together, adds the bag to your shelf, and puts
                it in the catalogue if the label is clear enough.
              </p>

              <div className="bc-bag-slots">
                {SLOTS.map((slot, index) => {
                  const file = photos[index] ?? null;
                  const preview = previews[index] ?? null;
                  return (
                    <span className="bc-field" key={slot.id}>
                      <label className="bc-kit__label" htmlFor={slot.id}>
                        {slot.label}{' '}
                        {slot.optional ? <span className="bc-muted">(optional)</span> : null}
                      </label>
                      {file && preview ? (
                        <span className="bc-photo-chosen">
                          <img
                            className="bc-photo-chosen__thumb"
                            src={preview}
                            alt={`The ${slot.label.toLowerCase()} you attached`}
                          />
                          <span className="bc-photo-chosen__text">
                            <span>{file.name}</span>
                            <span className="bc-muted">{formatBytes(file.size)}</span>
                          </span>
                          <button
                            type="button"
                            className="bc-button bc-button--quiet"
                            disabled={busy}
                            onClick={() =>
                              setPhotos((current) =>
                                current.map((existing, i) => (i === index ? null : existing)),
                              )
                            }
                          >
                            Remove
                          </button>
                        </span>
                      ) : (
                        <>
                          <input
                            id={slot.id}
                            {...(index === 0 ? { ref: fileInput } : {})}
                            className="bc-input"
                            type="file"
                            accept={IMAGE_ACCEPT}
                            capture="environment"
                            disabled={busy}
                            onChange={(event) => attach(event.target.files?.[0] ?? null, index)}
                          />
                          <span className="bc-muted" style={{ fontSize: '0.85rem' }}>
                            {slot.hint}
                          </span>
                        </>
                      )}
                    </span>
                  );
                })}
              </div>

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
                  Or press Ctrl+V (⌘V) anywhere in this box — it fills the next empty slot.{' '}
                  {PHOTO_PRIVACY_NOTE}
                </span>
              </span>

              <span className="bc-field">
                <label className="bc-kit__label" htmlFor="bag-note">
                  Anything the photo misses <span className="bc-muted">(optional)</span>
                </label>
                <textarea
                  id="bag-note"
                  className="bc-input"
                  rows={2}
                  maxLength={4000}
                  placeholder="e.g. the roast date is on the bottom seam"
                  value={description}
                  disabled={busy}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </span>

              <div className="bc-actions" style={{ marginTop: 0 }}>
                <button
                  type="button"
                  className="bc-button"
                  disabled={busy || (photos.every((file) => file === null) && description.trim() === '')}
                  onClick={() => void submitPhoto()}
                >
                  {busy ? 'Reading the label…' : 'Add this coffee'}
                </button>
                <button
                  type="button"
                  className="bc-button bc-button--quiet"
                  disabled={busy}
                  onClick={() => setManual(true)}
                >
                  Type it instead
                </button>
                <button
                  type="button"
                  className="bc-button bc-button--quiet"
                  disabled={busy}
                  onClick={reset}
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <p style={{ marginBottom: 0 }}>
                Straight onto your shelf. Nothing is published and nothing is read — this is
                just so you have something to log brews against.
              </p>
              <div className="bc-photo-paste">
                <span className="bc-field" style={{ flex: '1 1 10rem' }}>
                  <label className="bc-kit__label" htmlFor="bag-roaster">
                    Roaster <span className="bc-muted">(optional)</span>
                  </label>
                  <input
                    id="bag-roaster"
                    className="bc-input"
                    maxLength={120}
                    value={roaster}
                    disabled={busy}
                    onChange={(event) => setRoaster(event.target.value)}
                  />
                </span>
                <span className="bc-field" style={{ flex: '1 1 10rem' }}>
                  <label className="bc-kit__label" htmlFor="bag-name">
                    Coffee
                  </label>
                  <input
                    id="bag-name"
                    className="bc-input"
                    maxLength={160}
                    value={name}
                    disabled={busy}
                    onChange={(event) => setName(event.target.value)}
                  />
                </span>
              </div>
              <div className="bc-actions" style={{ marginTop: 0 }}>
                <button
                  type="button"
                  className="bc-button"
                  disabled={busy || name.trim() === ''}
                  onClick={() => void submitManual()}
                >
                  {busy ? 'Saving…' : 'Add to my shelf'}
                </button>
                <button
                  type="button"
                  className="bc-button bc-button--quiet"
                  disabled={busy}
                  onClick={() => setManual(false)}
                >
                  Use a photo
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {open_.length > 0 ? (
        <ul className="bc-kit">
          {open_.map((bag) => (
            <li key={bag.id} className="bc-kit__row">
              <span className="bc-kit__text">
                <span className="bc-kit__name">
                  {bag.slug ? <a href={`/coffee/${bag.slug}`}>{bag.name}</a> : bag.name}
                  {bag.is_custom ? (
                    <span className="bc-kit__badge bc-kit__badge--quiet">yours only</span>
                  ) : null}
                </span>
                <span className="bc-muted bc-kit__meta">
                  {[bag.roaster, bag.roast_date ? `roasted ${bag.roast_date}` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <span className="bc-kit__actions">
                <button
                  type="button"
                  className="bc-button bc-button--quiet"
                  onClick={() => void finishBag(bag.id).then(setShelf).catch(() => undefined)}
                >
                  Finished
                </button>
                <button
                  type="button"
                  className="bc-button bc-button--quiet"
                  onClick={() => void removeFromShelf(bag.id).then(setShelf).catch(() => undefined)}
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Reads the request back and says which of the three things happened. */
function describe(request: CoffeeRequest | undefined): Outcome {
  const draft = request?.ai_draft;
  const label = [draft?.roaster, draft?.name].filter(Boolean).join(' ').trim();

  if (request?.status === 'approved') {
    return { kind: 'published', label: label || 'That coffee' };
  }
  if (request?.status === 'rejected') {
    return {
      kind: 'rejected',
      why: request.decision_note ?? 'That did not look like a bag of coffee.',
    };
  }
  return { kind: 'shelved', label: label || 'That coffee' };
}

function OutcomeNote({ outcome }: { outcome: Outcome }) {
  if (outcome.kind === 'rejected') {
    return <Alert tone="info">{outcome.why}</Alert>;
  }
  if (outcome.kind === 'published') {
    return (
      <Alert tone="success" title={`${outcome.label} is on your shelf.`}>
        It is in the catalogue too, so other people can find it — and the roaster is listed as
        unverified until somebody confirms it.
      </Alert>
    );
  }
  return (
    <Alert tone="success" title={`${outcome.label} is on your shelf.`}>
      The label was not clear enough to publish, so this one is yours alone. It works exactly the
      same for logging brews.
    </Alert>
  );
}
