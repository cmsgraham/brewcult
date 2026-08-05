'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  confirmEnrolment,
  describeMfaError,
  groupSecret,
  isCompleteCode,
  normalizeCodeInput,
  type MfaEnrolment,
} from '../../lib/mfa-client';
import { Alert } from '../ui/alert';
import { CopyButton } from './copy-button';
import { QrCode } from './qr-code';
import styles from './security.module.css';

export interface EnrolmentStepProps {
  enrolment: MfaEnrolment;
  /** Handed the recovery codes exactly once. */
  onConfirmed: (codes: string[]) => void;
  onCancel: () => void;
}

/**
 * Step two of enrolment: pair an authenticator, then prove it worked.
 *
 * The API stores an *unconfirmed* secret at `/mfa/enrol` and only switches MFA
 * on once a code from that secret comes back. So a failed confirm is a normal,
 * recoverable state — the step keeps the QR, the secret and whatever was typed,
 * and shows the API's own message. Throwing the user back to the start on a
 * mistyped digit would be the single most likely way to make someone give up.
 *
 * Manual entry is not a fallback that appears when something breaks: it is
 * always on screen, next to the QR. Scanning assumes a second device with a
 * working camera, which is an assumption and not a fact.
 */
export function EnrolmentStep({ enrolment, onConfirmed, onCancel }: EnrolmentStepProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const codeField = useRef<HTMLInputElement>(null);

  // Moving between steps replaces the whole panel, so focus would otherwise
  // fall back to <body> and a keyboard or screen-reader user would lose their
  // place entirely. The heading rather than the code field on purpose: landing
  // in the input skips past the QR and the setup key, which is everything the
  // step is actually for.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  const grouped = groupSecret(enrolment.secret);
  const ready = isCompleteCode(code);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!ready || pending) return;
    setPending(true);
    setError(null);
    try {
      const codes = await confirmEnrolment(code);
      onConfirmed(codes);
    } catch (failure) {
      setError(describeMfaError(failure));
      // Keep the typed code: it is almost always a timing miss, and retyping
      // six digits to try the next window is pure friction.
      codeField.current?.focus();
      codeField.current?.select();
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="mfa-enrol-heading" className="bc-stack">
      <h2 className={styles.stepHeading} id="mfa-enrol-heading" ref={heading} tabIndex={-1}>
        Pair your authenticator app
      </h2>

      <p className="bc-muted">
        Any authenticator works — 1Password, Bitwarden, Authy, Google Authenticator, your
        phone&rsquo;s built-in one. Scan the code, or type the key in by hand if that is easier.
      </p>

      <div className={styles.enrolGrid}>
        <div className="bc-stack">
          <div className={styles.qrFrame}>
            <QrCode
              value={enrolment.otpauthUrl}
              label="Setup QR code for BrewCult two-factor authentication. If you cannot scan it, use the setup key shown next to it."
            />
          </div>
          <p className={styles.meta}>
            {enrolment.digits}-digit codes, refreshing every {enrolment.periodSeconds} seconds.
          </p>
        </div>

        <div className="bc-stack">
          <h3 style={{ marginBottom: 0 }}>Can&rsquo;t scan it?</h3>
          <p className="bc-muted" style={{ marginBottom: 0 }}>
            Choose &ldquo;enter a setup key&rdquo; in your app and type this. The spaces are
            there to make it readable — apps ignore them.
          </p>
          <code className={styles.secret} data-testid="mfa-secret">
            {grouped}
          </code>
          <CopyButton value={enrolment.secret} label="Copy setup key" />
        </div>
      </div>

      <form className="bc-form" onSubmit={onSubmit} noValidate>
        {error ? <Alert tone="error">{error}</Alert> : null}

        <div className="bc-field">
          <label htmlFor="mfa-confirm-code">Six-digit code from your app</label>
          <span className="bc-field__hint" id="mfa-confirm-code-hint">
            This proves the pairing worked. If it says the code is not valid, wait for the next
            one and try again — nothing is lost.
          </span>
          <input
            id="mfa-confirm-code"
            ref={codeField}
            className={`bc-input ${styles.codeInput}`}
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={code}
            onChange={(event) => setCode(normalizeCodeInput(event.target.value))}
            aria-invalid={error ? true : undefined}
            aria-describedby="mfa-confirm-code-hint"
          />
        </div>

        <div className={styles.inlineActions}>
          <button className="bc-button" type="submit" disabled={!ready || pending}>
            {pending ? 'Checking…' : 'Turn on two-factor'}
          </button>
          <button
            className="bc-button bc-button--quiet"
            type="button"
            onClick={onCancel}
            disabled={pending}
          >
            Not right now
          </button>
        </div>
      </form>
    </section>
  );
}
