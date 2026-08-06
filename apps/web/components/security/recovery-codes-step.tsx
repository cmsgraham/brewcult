'use client';

import { useEffect, useRef, useState } from 'react';
import { recoveryCodesFile } from '../../lib/mfa-client';
import { useTranslate } from '../locale-provider';
import { Alert } from '../ui/alert';
import { CopyButton } from './copy-button';
import styles from './security.module.css';

export interface RecoveryCodesStepProps {
  codes: readonly string[];
  handle: string;
  /** Why the codes are on screen — changes the framing, not the warning. */
  origin: 'enrolled' | 'regenerated';
  /** Called once the person has ticked the acknowledgement. */
  onAcknowledged: () => void;
}

/**
 * The one and only showing of the recovery codes.
 *
 * The API stores them hashed, so this response is the sole copy that will ever
 * exist. Three consequences shape this component:
 *
 *  1. **Nothing persists them.** They arrive as a prop from React state and are
 *     dropped when the step unmounts. No storage, no URL, no cache.
 *  2. **The exit is deliberate.** A checkbox gates the only way forward. It is
 *     friction on purpose: "I closed the tab and lost them" is an
 *     account-recovery ticket, and the whole point of the codes is not needing
 *     one.
 *  3. **Two ways to save them**, because the clipboard is not available
 *     everywhere and a downloaded file is not welcome on a shared machine.
 */
export function RecoveryCodesStep({
  codes,
  handle,
  origin,
  onAcknowledged,
}: RecoveryCodesStepProps) {
  const t = useTranslate();
  const [acknowledged, setAcknowledged] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  const asText = recoveryCodesFile(codes, handle, t);

  function download(): void {
    try {
      // Built and revoked in the same tick — the blob never outlives the click,
      // and nothing about it is written anywhere we could forget to clean up.
      const url = URL.createObjectURL(new Blob([asText], { type: 'text/plain;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `brewcult-recovery-codes-${handle}.txt`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setDownloadFailed(false);
    } catch {
      // Blob downloads are blocked in some in-app browsers and locked-down
      // enterprise profiles. Failing silently on the one screen where the data
      // cannot be re-fetched is not an option, so say so and point at the codes.
      setDownloadFailed(true);
    }
  }

  return (
    <section aria-labelledby="mfa-codes-heading" className="bc-stack">
      <h2 className={styles.stepHeading} id="mfa-codes-heading" ref={heading} tabIndex={-1}>
        {origin === 'enrolled'
          ? t('security.codes.headingEnrolled')
          : t('security.codes.headingRegenerated')}
      </h2>

      <Alert tone="error" title={t('security.codes.warnTitle')}>
        {t('security.codes.warnBody')}
      </Alert>

      {origin === 'regenerated' ? (
        <p className="bc-muted">{t('security.codes.regeneratedNote')}</p>
      ) : null}

      <ul
        className={styles.codeList}
        aria-label={t('security.codes.listLabel')}
        data-testid="recovery-codes"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>

      <p className="bc-muted">{t('security.codes.keepNote')}</p>

      <div className={styles.inlineActions}>
        <CopyButton value={codes.join('\n')} label={t('security.codes.copyAll')} />
        <button type="button" className="bc-button bc-button--quiet" onClick={download}>
          {t('security.codes.download')}
        </button>
      </div>

      <p aria-live="polite" className={styles.meta}>
        {downloadFailed ? t('security.codes.downloadBlocked') : null}
      </p>

      <div className="bc-panel bc-stack">
        <label className={styles.ack} htmlFor="mfa-codes-ack">
          <input
            id="mfa-codes-ack"
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          <span>{t('security.codes.ack')}</span>
        </label>
        <button
          type="button"
          className="bc-button"
          disabled={!acknowledged}
          onClick={onAcknowledged}
        >
          {t('security.codes.done')}
        </button>
      </div>
    </section>
  );
}
