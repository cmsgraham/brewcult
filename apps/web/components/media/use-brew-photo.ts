'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FetchLike } from '../../lib/api';
import type { BrewUpsertBody, LocalBrewRecord } from '../../lib/brewing-client';
import { KEYS, type BrewEngine } from '../../lib/offline/engine';
import {
  describeMediaError,
  dropPendingPhoto,
  flushPendingPhotos,
  isOfflineError,
  isRetryableMediaError,
  stashPendingPhoto,
  uploadMedia,
  validateImageFile,
  type MediaAsset,
} from '../../lib/media-client';
import type { UploadController, UploadStatus } from './image-upload';

/**
 * The brew logger's photo, and the whole reason this file exists separately from
 * the uploader: **the photo must never gate the log.**
 *
 * docs/brew_logger_ux.md §4 lists Photo under "what we deliberately do NOT ask":
 * *"Optional, and never blocks the log — it's a sharing affordance."* §1 puts a
 * 15-second median on time-to-log, and §5 says the session is persisted locally
 * and rendered as logged immediately, with the network happening afterwards.
 *
 * So the photo follows the brew, never the other way round:
 *
 *   pick a photo  → upload starts in the background (nothing is awaited)
 *   tap "Log brew" → session written to IndexedDB → rendered as logged
 *   upload lands   → the *already logged* session is amended with
 *                    `photo_media_id` and re-queued as one idempotent PUT
 *
 * Every branch of that keeps the brew:
 *
 *  - upload still running at log time → the log does not wait; `attachTo`
 *    remembers the session and amends when the promise settles.
 *  - upload fails transiently (offline, 5xx, rate limit) → the photo is parked
 *    in the offline store keyed by session id and retried on the next mount or
 *    `online` event. The brew is untouched.
 *  - upload fails permanently (too big, wrong type, quota) → the user gets one
 *    plain line of copy. The brew is untouched.
 *  - the photo endpoint does not exist yet (404/501) → same. The brew is
 *    untouched.
 *
 * There is deliberately no code path in which a photo failure can reach the
 * logging call. `attachTo` is synchronous and non-throwing; everything async it
 * starts is fire-and-forget with its own catch.
 *
 * Path A ("brew this again") never renders this control at all — one tap, one
 * interaction, no photo prompt (§3). The offer appears *after* the log instead.
 */

export interface BrewPhotoController extends UploadController {
  /** Media id once the upload has landed — null while in flight or failed. */
  mediaId: string | null;
  /** A photo is selected for the brew being logged (uploaded or not yet). */
  hasPhoto: boolean;
  /**
   * Give the photo to a brew that is already on the device.
   * Synchronous, never throws, never awaited by the caller.
   */
  attachTo: (session: BrewUpsertBody) => void;
  /** Forget everything and be ready for the next brew. */
  reset: () => void;
}

export interface UseBrewPhotoOptions {
  engine: BrewEngine;
  fetchImpl?: FetchLike;
  /** Test seam. */
  now?: () => number;
}

const IDLE_HINT = 'Optional. Add it before or after you log — it never holds the log up.';

export function useBrewPhoto({ engine, fetchImpl, now }: UseBrewPhotoOptions): BrewPhotoController {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(IDLE_HINT);
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [hasPhoto, setHasPhoto] = useState(false);

  const aliveRef = useRef(true);
  const objectUrlRef = useRef<string | null>(null);
  const fileRef = useRef<File | null>(null);
  const assetRef = useRef<MediaAsset | null>(null);
  const uploadRef = useRef<Promise<MediaAsset | null> | null>(null);
  const sessionRef = useRef<BrewUpsertBody | null>(null);

  /* --- attaching to a session that already exists on the device ----- */

  /**
   * Amend a logged session with the media id.
   *
   * Reads the stored record first rather than trusting the copy captured at log
   * time, so a rating added between the log and the upload is not clobbered.
   * Failure is swallowed on purpose: the brew is already safe locally and the
   * queue owns its own retries — a photo can never be the reason a log looks
   * broken.
   */
  const amend = useCallback(
    async (
      sessionId: string,
      fallback: BrewUpsertBody | null,
      id: string | null,
    ): Promise<void> => {
      try {
        const stored = await engine.store.get<LocalBrewRecord>(KEYS.session(sessionId));
        const session = stored?.session ?? fallback;
        if (!session) return;
        await engine.amendBrew({ ...session, photo_media_id: id });
      } catch {
        /* the brew is on the device either way */
      }
    },
    [engine],
  );

  /* --- the parked-photo retry loop ---------------------------------- */

  const flush = useCallback(async (): Promise<void> => {
    try {
      await flushPendingPhotos({
        store: engine.store,
        ...(fetchImpl ? { fetchImpl } : {}),
        attach: (sessionId, asset) => amend(sessionId, null, asset.id),
      });
    } catch {
      /* nothing here is allowed to surface */
    }
  }, [amend, engine, fetchImpl]);

  useEffect(() => {
    aliveRef.current = true;
    void flush();

    const onOnline = () => {
      void flush();
    };
    if (typeof window !== 'undefined') window.addEventListener('online', onOnline);

    return () => {
      aliveRef.current = false;
      if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
      revoke(objectUrlRef.current);
      objectUrlRef.current = null;
    };
  }, [flush]);

  /* --- selection + upload ------------------------------------------- */

  /** Drop the photo state. Says nothing about the session it may be bound to. */
  const forget = useCallback(() => {
    revoke(objectUrlRef.current);
    objectUrlRef.current = null;
    fileRef.current = null;
    assetRef.current = null;
    uploadRef.current = null;
    setPreviewUrl(null);
    setStatus('idle');
    setError(null);
    setStatusText(IDLE_HINT);
    setMediaId(null);
    setHasPhoto(false);
  }, []);

  /** Ready for the next brew — used when the user logs another. */
  const reset = useCallback(() => {
    forget();
    sessionRef.current = null;
  }, [forget]);

  /**
   * The user pressing "Remove photo". If the photo already reached a logged
   * session it is detached there too, and any parked copy is binned — otherwise
   * "removed" would be a lie the next sync quietly corrects.
   */
  const clear = useCallback(() => {
    const session = sessionRef.current;
    const attached = assetRef.current;
    forget();
    if (session === null) return;
    void dropPendingPhoto(engine.store, session.id);
    if (attached) void amend(session.id, session, null);
  }, [amend, engine, forget]);

  const park = useCallback(
    async (sessionId: string, file: File): Promise<void> => {
      const stashed = await stashPendingPhoto(engine.store, {
        sessionId,
        file,
        kind: 'brew_photo',
        ...(now ? { now } : {}),
      });
      if (!aliveRef.current) return;
      setStatusText(
        stashed
          ? 'Your brew is logged. The photo is waiting on this device and uploads when you have signal.'
          : 'Your brew is logged. That photo was too big to hold on to — add it again later.',
      );
    },
    [engine, now],
  );

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
        setStatusText(null);
        return;
      }

      revoke(objectUrlRef.current);
      const preview = createObjectUrl(file);
      objectUrlRef.current = preview;
      fileRef.current = file;
      assetRef.current = null;
      setPreviewUrl(preview);
      setHasPhoto(true);
      setMediaId(null);
      setError(null);
      setStatus('uploading');
      setStatusText('Uploading in the background. You can log the brew now.');

      // Fire and forget. Nothing downstream ever awaits this promise except the
      // attach step, which is itself fire-and-forget.
      uploadRef.current = uploadMedia(file, 'brew_photo', {
        ...(fetchImpl ? { fetchImpl } : {}),
      })
        .then((asset) => {
          assetRef.current = asset;
          if (aliveRef.current) {
            // The stored image replaces the local blob — same picture, and the
            // object URL can go back to the browser.
            revoke(objectUrlRef.current);
            objectUrlRef.current = null;
            setPreviewUrl(asset.thumbnail_url ?? asset.url);
            setStatus('ready');
            setMediaId(asset.id);
            setError(null);
            setStatusText('Photo saved with this brew.');
          }
          const session = sessionRef.current;
          if (session) void amend(session.id, session, asset.id);
          return asset;
        })
        .catch((cause: unknown) => {
          const retryable = isRetryableMediaError(cause);
          const session = sessionRef.current;

          // A rejection that retrying cannot fix (too big, wrong type, quota,
          // no endpoint) means the bytes are dead weight — drop the reference
          // so nothing later parks them for a retry that can only fail again.
          if (!retryable) fileRef.current = null;

          if (aliveRef.current) {
            setStatus(retryable ? 'queued' : 'error');
            setError(retryable ? null : describeMediaError(cause));
            setStatusText(
              !retryable
                ? null
                : isOfflineError(cause)
                  ? session
                    ? 'Your brew is logged. The photo uploads when you have signal.'
                    : "No signal — log the brew now and the photo follows when you're back online."
                  : // A daily upload cap or a server wobble: say what the API
                    // said, then say what happens next.
                    `${describeMediaError(cause)} We'll try the photo again later.`,
            );
          }
          if (session) void park(session.id, file);
          return null;
        });
    },
    [amend, clear, fetchImpl, park],
  );

  /* --- the seam the logger calls, immediately after logging ---------- */

  const attachTo = useCallback(
    (session: BrewUpsertBody) => {
      sessionRef.current = session;
      if (!fileRef.current && !assetRef.current) return;

      const asset = assetRef.current;
      if (asset) {
        void amend(session.id, session, asset.id);
        return;
      }

      const inFlight = uploadRef.current;
      if (inFlight) {
        void inFlight.then((settled) => {
          if (settled) {
            void amend(session.id, session, settled.id);
            return;
          }
          // Re-read rather than closing over the file: a permanent rejection
          // clears it, and parking dead bytes helps nobody.
          const file = fileRef.current;
          if (file) void park(session.id, file);
        });
        return;
      }

      const file = fileRef.current;
      if (file) void park(session.id, file);
    },
    [amend, park],
  );

  return {
    previewUrl,
    status,
    error,
    statusText,
    mediaId,
    hasPhoto,
    select,
    clear,
    reset,
    attachTo,
  };
}

/* ------------------------------------------------------------------ *
 * Object URLs — jsdom does not implement them, so both helpers no-op there.
 * ------------------------------------------------------------------ */

function createObjectUrl(file: File): string | null {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
  try {
    return URL.createObjectURL(file);
  } catch {
    return null;
  }
}

function revoke(url: string | null): void {
  if (url === null || typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    /* the page is going away anyway */
  }
}
