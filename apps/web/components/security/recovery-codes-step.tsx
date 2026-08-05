'use client';

import { useEffect, useRef, useState } from 'react';
import { recoveryCodesFile } from '../../lib/mfa-client';
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
  const [acknowledged, setAcknowledged] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  const asText = recoveryCodesFile(codes, handle);

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
          ? 'Two-factor is on. Save these recovery codes.'
          : 'Here is your new set of recovery codes.'}
      </h2>

      <Alert tone="error" title="You will not see these again.">
        We store them scrambled, so we genuinely cannot show them to you a second time. If you
        lose both your authenticator app and these codes, getting back in means proving who you
        are to a human, and that takes days.
      </Alert>

      {origin === 'regenerated' ? (
        <p className="bc-muted">
          Your old codes stopped working the moment these were made. If you had them written
          down somewhere, replace them now.
        </p>
      ) : null}

      <ul className={styles.codeList} aria-label="Your recovery codes" data-testid="recovery-codes">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>

      <p className="bc-muted">
        Each one works once, in place of a code from your app. Keep them somewhere that is not
        the phone your authenticator lives on — a password manager, or paper in a drawer.
      </p>

      <div className={styles.inlineActions}>
        <CopyButton value={codes.join('\n')} label="Copy all codes" />
        <button type="button" className="bc-button bc-button--quiet" onClick={download}>
          Download as a text file
        </button>
      </div>

      <p aria-live="polite" className={styles.meta}>
        {downloadFailed
          ? 'Your browser blocked the download. Copy the codes above instead, or write them down — they are on screen and this is the only time we can show them.'
          : null}
      </p>

      <div className="bc-panel bc-stack">
        <label className={styles.ack} htmlFor="mfa-codes-ack">
          <input
            id="mfa-codes-ack"
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          <span>I&rsquo;ve saved my recovery codes somewhere safe.</span>
        </label>
        <button
          type="button"
          className="bc-button"
          disabled={!acknowledged}
          onClick={onAcknowledged}
        >
          Done
        </button>
      </div>
    </section>
  );
}
