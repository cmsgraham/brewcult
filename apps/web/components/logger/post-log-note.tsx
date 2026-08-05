'use client';

import type { TasteVerdict } from '@brewcult/shared-types';
import { useState } from 'react';
import type { PaybackLine } from '../../lib/brewing-client';
import { TasteRow } from './taste-row';

export interface PostLogNoteProps {
  payback: PaybackLine;
  verdict: TasteVerdict | null;
  onRate: (verdict: TasteVerdict | null) => void;
  onLogAnother: () => void;
  onRemindMe?: () => void;
  /** Queue state, so "saved" is never a lie. */
  synced: boolean;
  pending: number;
  /** Text to share when the platform can (never a fake button). */
  shareText?: string;
}

/**
 * The moment after logging (brew_logger_ux §6).
 *
 *  - the log is announced as done *immediately* — it is already on the device;
 *  - one honest line of payback: a trend or a suggestion, and never a streak;
 *  - "how was it?" is offered, not demanded (§3: an unrated repeat is still
 *    valuable data), and it is the same single offer as at log time — never a
 *    second prompt for the same session (§8 decision 3);
 *  - copy stays warm. A bitter brew is normal, not a failure.
 */
export function PostLogNote({
  payback,
  verdict,
  onRate,
  onLogAnother,
  onRemindMe,
  synced,
  pending,
  shareText,
}: PostLogNoteProps) {
  const [reminded, setReminded] = useState(false);
  const canShare =
    typeof navigator !== 'undefined' &&
    typeof (navigator as Navigator & { share?: unknown }).share === 'function' &&
    Boolean(shareText);

  return (
    <div className="bc-logger__logged bc-stack" role="status" aria-live="polite">
      <p className="bc-logger__logged-title">
        <span aria-hidden="true">✅ </span>Logged.
      </p>

      <p className="bc-logger__payback">{payback.line}</p>

      {payback.suggestion && onRemindMe ? (
        reminded ? (
          <p className="bc-muted">It&apos;ll be waiting on tomorrow&apos;s card.</p>
        ) : (
          <button
            type="button"
            className="bc-button bc-button--quiet"
            onClick={() => {
              setReminded(true);
              onRemindMe();
            }}
          >
            Remind me tomorrow
          </button>
        )
      ) : null}

      {verdict === null ? (
        <TasteRow value={verdict} onChange={onRate} legend="Rate it when you've tasted it" compact />
      ) : null}

      <p className="bc-muted bc-logger__sync">
        {synced
          ? 'Synced.'
          : pending > 0
            ? 'Saved on this device. It syncs itself when you have signal.'
            : 'Saved on this device.'}
      </p>

      <div className="bc-logger__actions">
        <button type="button" className="bc-button" onClick={onLogAnother}>
          Log another
        </button>
        {canShare ? (
          <button
            type="button"
            className="bc-button bc-button--quiet"
            onClick={() => {
              void (navigator as Navigator & { share: (data: ShareData) => Promise<void> })
                .share({ text: shareText ?? '' })
                .catch(() => undefined);
            }}
          >
            Share this brew
          </button>
        ) : null}
      </div>
    </div>
  );
}
