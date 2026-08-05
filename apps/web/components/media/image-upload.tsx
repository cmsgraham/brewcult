'use client';

import { useCallback, useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from 'react';
import type { FetchLike } from '../../lib/api';
import {
  IMAGE_ACCEPT,
  MAX_IMAGE_BYTES,
  PHOTO_PRIVACY_NOTE,
  describeMediaError,
  formatBytes,
  uploadMedia,
  validateImageFile,
  type MediaAsset,
  type MediaKind,
} from '../../lib/media-client';
import styles from './media.module.css';

/**
 * The one image uploader. Everything that takes a picture in BrewCult uses it:
 * the profile avatar, the logger's optional brew photo, and (when the operator
 * console wires it) catalog artwork.
 *
 * Accessibility, in the order it matters:
 *  - a **real `<input type="file">`** with a real `<label>`; the drop zone is
 *    that label, so a click anywhere opens the picker and Enter/Space work
 *    natively. Nothing here reimplements a button out of a div.
 *  - `capture="environment"` when `capture` is set, so a phone offers the rear
 *    camera directly — and desktop browsers ignore the attribute, so the same
 *    control is a plain picker there.
 *  - status is announced through an `aria-live="polite"` region and failures
 *    through `role="alert"`, so a screen-reader user learns the upload finished
 *    without watching for a spinner.
 *  - drag and drop is an *addition*: every drop target is reachable without it.
 *
 * ── Two lifecycles, one component ────────────────────────────────────────────
 * By default the component owns the upload: pick a file → POST → `onUploaded`.
 * That is right for an avatar, where the picture *is* the change.
 *
 * The brew logger cannot work that way — the photo must never gate the log
 * (brew_logger_ux §4) — so it passes its own {@link UploadController} and keeps
 * the upload alive across the log itself. When `controller` is supplied this
 * component renders state and captures files; it uploads nothing.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type UploadStatus = 'idle' | 'uploading' | 'ready' | 'queued' | 'error';

export interface UploadController {
  /** Local object URL or remote URL — whatever should be shown right now. */
  previewUrl: string | null;
  status: UploadStatus;
  error: string | null;
  /** A line for the live region; the component supplies a default when null. */
  statusText?: string | null;
  select: (file: File | null) => void;
  clear: () => void;
}

export interface ImageUploadProps {
  /** Visible label for the input. Required — there is no placeholder-as-label. */
  label: string;
  /**
   * What the upload is for. Required by the API, which validates it before
   * reading the body and uses it to decide who is allowed to upload at all.
   * Ignored when a `controller` owns the lifecycle.
   */
  kind?: MediaKind;
  hint?: ReactNode;
  /** Existing image to show before anything is picked (e.g. today's avatar). */
  currentUrl?: string | null;
  /** Offer the camera on mobile. Photos of a brew: yes. A profile picture: yes. */
  capture?: boolean;
  /** Show the one-line location-stripping note. On by default. */
  showPrivacyNote?: boolean;
  /** Tighter layout for inline use inside the logger card. */
  compact?: boolean;
  /** Called after a successful upload (self-managed mode only). */
  onUploaded?: (asset: MediaAsset) => void | Promise<void>;
  /** Called when the user removes the picture. Both modes. */
  onRemove?: () => void | Promise<void>;
  /** Supply to take over the upload lifecycle — see the header note. */
  controller?: UploadController;
  /** Injected in tests. */
  fetchImpl?: FetchLike;
  /** Disable the whole control (e.g. the endpoint is not deployed yet). */
  disabled?: boolean;
  /** Copy for the empty drop zone. */
  ctaText?: string;
}

const DEFAULT_STATUS_TEXT: Record<UploadStatus, string | null> = {
  idle: null,
  uploading: 'Uploading your photo…',
  ready: 'Photo added.',
  queued: 'Saved on this device — it uploads when you have signal.',
  error: null,
};

/** Object URLs are a leak if nobody revokes them; jsdom does not implement them. */
function createPreviewUrl(file: File): string | null {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
  try {
    return URL.createObjectURL(file);
  } catch {
    return null;
  }
}

function revokePreviewUrl(url: string | null): void {
  if (url === null || typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    /* nothing to do — the URL is going away with the page anyway */
  }
}

/**
 * The self-managed upload lifecycle: validate → preview → POST → report.
 * Exported so a caller that wants the behaviour but not the markup can reuse it.
 */
export function useImageUpload(options: {
  /** What the upload is for. The API requires it and gates permission on it. */
  kind: MediaKind;
  fetchImpl?: FetchLike;
  onUploaded?: (asset: MediaAsset) => void | Promise<void>;
}): UploadController & { asset: MediaAsset | null } {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [asset, setAsset] = useState<MediaAsset | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const aliveRef = useRef(true);
  const { fetchImpl, kind, onUploaded } = options;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      revokePreviewUrl(objectUrlRef.current);
      objectUrlRef.current = null;
    };
  }, []);

  const clear = useCallback(() => {
    revokePreviewUrl(objectUrlRef.current);
    objectUrlRef.current = null;
    setPreviewUrl(null);
    setStatus('idle');
    setError(null);
    setAsset(null);
  }, []);

  const select = useCallback(
    (file: File | null) => {
      if (file === null) {
        clear();
        return;
      }

      const complaint = validateImageFile(file);
      if (complaint !== null) {
        setStatus('error');
        setError(complaint);
        return;
      }

      revokePreviewUrl(objectUrlRef.current);
      const next = createPreviewUrl(file);
      objectUrlRef.current = next;
      setPreviewUrl(next);
      setStatus('uploading');
      setError(null);

      void (async () => {
        try {
          const uploaded = await uploadMedia(file, kind, {
            ...(fetchImpl ? { fetchImpl } : {}),
          });
          if (!aliveRef.current) return;
          // Swap the local blob for the stored image: the served file is what
          // everyone else will see, and it frees the object URL immediately.
          revokePreviewUrl(objectUrlRef.current);
          objectUrlRef.current = null;
          setPreviewUrl(uploaded.thumbnail_url ?? uploaded.url);
          setAsset(uploaded);
          setStatus('ready');
          await onUploaded?.(uploaded);
        } catch (cause) {
          if (!aliveRef.current) return;
          setStatus('error');
          setError(describeMediaError(cause));
        }
      })();
    },
    [clear, fetchImpl, kind, onUploaded],
  );

  return { previewUrl, status, error, select, clear, asset };
}

export function ImageUpload({
  label,
  kind = 'avatar',
  hint,
  currentUrl = null,
  capture = false,
  showPrivacyNote = true,
  compact = false,
  onUploaded,
  onRemove,
  controller,
  fetchImpl,
  disabled = false,
  ctaText,
}: ImageUploadProps) {
  const internal = useImageUpload({
    kind,
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(onUploaded ? { onUploaded } : {}),
  });
  const active = controller ?? internal;

  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const inputId = `${baseId}-file`;
  const hintId = `${baseId}-hint`;
  const statusId = `${baseId}-status`;
  const errorId = `${baseId}-error`;

  const shownUrl = active.previewUrl ?? currentUrl;
  const hasImage = shownUrl !== null;
  const statusText =
    active.statusText !== undefined
      ? active.statusText
      : DEFAULT_STATUS_TEXT[active.status];

  function handleFiles(files: FileList | null): void {
    const file = files?.[0] ?? null;
    if (file !== null) active.select(file);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    // Handled here rather than by the input underneath, so the drop is
    // processed exactly once.
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    handleFiles(event.dataTransfer?.files ?? null);
  }

  const dropzoneClass = [
    styles.dropzone,
    compact ? styles.dropzoneCompact : '',
    dragging ? styles.dropzoneActive : '',
  ]
    .filter(Boolean)
    .join(' ');

  const describedBy = [hint ? hintId : '', statusId, active.error ? errorId : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={styles.uploader}>
      <label className={styles.label} htmlFor={inputId}>
        {label}
      </label>

      {hint ? (
        <p className={styles.hint} id={hintId}>
          {hint}
        </p>
      ) : null}

      {/* The input itself covers the whole drop zone at zero opacity, so a click
          anywhere opens the picker, a native file drop lands on a real input,
          and the control stays in the tab order with Enter/Space working. No
          div-pretending-to-be-a-button anywhere in here. */}
      <div
        className={dropzoneClass}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        data-testid="image-upload-dropzone"
      >
        {hasImage ? (
          /* Plain <img>: the media host is a separate origin — see avatar.tsx. */
          <img
            className={compact ? `${styles.preview} ${styles.previewCompact}` : styles.preview}
            src={shownUrl}
            alt=""
            loading="lazy"
            decoding="async"
          />
        ) : null}

        <span className={styles.dropzoneCopy}>
          <span className={styles.dropzoneTitle}>
            {hasImage ? 'Choose a different photo' : (ctaText ?? 'Add a photo')}
          </span>
          <span className={styles.dropzoneSub}>
            {capture
              ? `Take one, or pick a file. Up to ${formatBytes(MAX_IMAGE_BYTES)}.`
              : `Drop one here or pick a file. Up to ${formatBytes(MAX_IMAGE_BYTES)}.`}
          </span>
        </span>

        <input
          ref={inputRef}
          className={styles.input}
          id={inputId}
          type="file"
          accept={IMAGE_ACCEPT}
          {...(capture ? { capture: 'environment' as const } : {})}
          disabled={disabled}
          aria-describedby={describedBy}
          aria-busy={active.status === 'uploading'}
          onChange={(event) => {
            handleFiles(event.target.files);
            // Let the same file be picked twice in a row (retry after a failure).
            event.target.value = '';
          }}
        />
      </div>

      {active.status === 'uploading' ? (
        <span className={styles.bar} aria-hidden="true">
          <span className={styles.barFill} />
        </span>
      ) : null}

      {/* Polite: finishing an upload must not interrupt a screen reader. */}
      <p className={styles.status} id={statusId} role="status" aria-live="polite">
        {statusText ?? ''}
      </p>

      {active.error ? (
        <p className={styles.error} id={errorId} role="alert">
          {active.error}
        </p>
      ) : null}

      {hasImage || active.status === 'error' ? (
        <div className={styles.actions}>
          <button
            type="button"
            className="bc-button bc-button--quiet"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            {active.status === 'error' ? 'Try another photo' : 'Replace photo'}
          </button>
          {hasImage ? (
            <button
              type="button"
              className="bc-button bc-button--quiet"
              disabled={disabled}
              onClick={() => {
                active.clear();
                void onRemove?.();
              }}
            >
              Remove photo
            </button>
          ) : null}
        </div>
      ) : null}

      {showPrivacyNote ? <p className={styles.hint}>{PHOTO_PRIVACY_NOTE}</p> : null}
    </div>
  );
}
