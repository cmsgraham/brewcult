'use client';

import type { TasteVerdict } from '@brewcult/shared-types';
import { useState } from 'react';
import { DialInAdvice } from '../ai/dial-in-advice';
import type { FetchLike } from '../../lib/api';
import type { PaybackLine } from '../../lib/brewing-client';
import { TasteRow } from './taste-row';
import { CheckIcon } from '../ui/icon';
import { useTranslate } from '../locale-provider';

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
  /**
   * Optional AI dial-in advice (second_draft §7.1). Absent — or present with no
   * taste verdict — means this card behaves exactly as it always has: the static
   * payback line, and no request. When it *is* present and the brew was tasted,
   * the AI's single suggestion replaces the static one once (and if) it arrives.
   */
  dialIn?: { brewSessionId: string; fetchImpl?: FetchLike };
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
  dialIn,
}: PostLogNoteProps) {
  const t = useTranslate();
  const [reminded, setReminded] = useState(false);
  const canShare =
    typeof navigator !== 'undefined' &&
    typeof (navigator as Navigator & { share?: unknown }).share === 'function' &&
    Boolean(shareText);

  /**
   * The line this card has always shown. It is also the AI's fallback: if the
   * diagnosis 404s, 500s, times out or never ships, this is what stays on screen
   * and the user is never told that something they didn't ask for didn't happen.
   */
  const staticPayback = (
    <>
      <p className="bc-logger__payback">{payback.line}</p>

      {payback.suggestion && onRemindMe ? (
        reminded ? (
          <p className="bc-muted">{t('brew.reminded')}</p>
        ) : (
          <button
            type="button"
            className="bc-button bc-button--quiet"
            onClick={() => {
              setReminded(true);
              onRemindMe();
            }}
          >
            {t('brew.remindMe')}
          </button>
        )
      ) : null}
    </>
  );

  return (
    <div className="bc-logger__logged bc-stack" role="status" aria-live="polite">
      <p className="bc-logger__logged-title">
        <CheckIcon className="bc-logger__logged-icon" />
        {t('brew.logged')}
      </p>

      {/* Advice is only worth asking for once there is a taste to explain — an
          unrated brew gets no request at all, and costs no tokens. */}
      {dialIn && verdict ? (
        <DialInAdvice
          brewSessionId={dialIn.brewSessionId}
          verdict={verdict}
          fallback={staticPayback}
          {...(dialIn.fetchImpl ? { fetchImpl: dialIn.fetchImpl } : {})}
        />
      ) : (
        staticPayback
      )}

      {verdict === null ? (
        <TasteRow value={verdict} onChange={onRate} legend={t('brew.rateWhenTasted')} compact />
      ) : null}

      <p className="bc-muted bc-logger__sync">
        {synced
          ? t('brew.synced')
          : pending > 0
            ? t('brew.savedOffline')
            : t('brew.savedLocally')}
      </p>

      <div className="bc-logger__actions">
        <button type="button" className="bc-button" onClick={onLogAnother}>
          {t('brew.logAnother')}
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
            {t('brew.share')}
          </button>
        ) : null}
      </div>
    </div>
  );
}
