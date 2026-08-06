'use client';

import { useCallback, useState } from 'react';
import type { FetchLike } from '../../lib/api';
import {
  deleteMedia,
  describeMediaError,
  isMediaUnavailable,
  setAvatar,
  type MediaAsset,
} from '../../lib/media-client';
import { useTranslate } from '../locale-provider';
import { Avatar } from './avatar';
import { ImageUpload } from './image-upload';
import styles from './media.module.css';

/**
 * Profile picture: upload, replace, remove.
 *
 * Two behaviours worth naming:
 *
 *  1. **The upload and the assignment are two calls.** `POST /media` stores the
 *     bytes; `PUT /users/me/avatar` points the account at them. If the second
 *     fails the first is rolled back with a best-effort `DELETE /media/:id`, so
 *     a half-finished attempt does not quietly consume the user's quota.
 *  2. **A missing endpoint is a sentence, not a stack trace.** Media is landing
 *     in parallel; until it does, every call here answers 404/501 and the panel
 *     says so plainly instead of pretending something broke.
 */

export interface AvatarEditorProps {
  initialUrl?: string | null;
  displayName?: string | null;
  handle?: string | null;
  /** Injected in tests. */
  fetchImpl?: FetchLike;
}

export function AvatarEditor({
  initialUrl = null,
  displayName = null,
  handle = null,
  fetchImpl,
}: AvatarEditorProps) {
  const t = useTranslate();
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const onUploaded = useCallback(
    async (asset: MediaAsset) => {
      const request = fetchImpl ? { fetchImpl } : {};
      setFailure(null);
      setNotice(null);
      try {
        await setAvatar(asset.id, request);
        setUrl(asset.url);
        setNotice(t('media.avatarSet'));
      } catch (error) {
        if (isMediaUnavailable(error)) setUnavailable(true);
        setFailure(describeMediaError(error));
        // Do not leave orphaned bytes behind a failed assignment.
        try {
          await deleteMedia(asset.id, request);
        } catch {
          /* best effort — the API can garbage-collect an unreferenced upload */
        }
      }
    },
    [fetchImpl, t],
  );

  const onRemove = useCallback(async () => {
    const request = fetchImpl ? { fetchImpl } : {};
    setFailure(null);
    setNotice(null);
    try {
      await setAvatar(null, request);
      setUrl(null);
      setNotice(t('media.avatarRemoved'));
    } catch (error) {
      if (isMediaUnavailable(error)) setUnavailable(true);
      setFailure(describeMediaError(error));
    }
  }, [fetchImpl, t]);

  return (
    <div className={styles.avatarEditor}>
      <div className={styles.avatarRow}>
        <Avatar src={url} displayName={displayName} handle={handle} size={96} alt="" />

        <div className={styles.avatarEditorControls}>
          <ImageUpload
            label={t('media.avatarLabel')}
            kind="avatar"
            hint={t('media.avatarHint')}
            currentUrl={url}
            capture
            disabled={unavailable}
            {...(fetchImpl ? { fetchImpl } : {})}
            onUploaded={onUploaded}
            onRemove={onRemove}
            ctaText={t('media.avatarCta')}
          />
        </div>
      </div>

      {unavailable ? (
        <p className="bc-muted" role="status">
          {t('media.avatarNotSwitchedOn')}
        </p>
      ) : null}

      {notice ? (
        <p className="bc-muted" role="status">
          {notice}
        </p>
      ) : null}

      {failure && !unavailable ? (
        <p className={styles.error} role="alert">
          {failure}
        </p>
      ) : null}
    </div>
  );
}
