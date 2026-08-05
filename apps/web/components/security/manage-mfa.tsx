'use client';

import { useState, type FormEvent } from 'react';
import {
  describeMfaError,
  disableMfa,
  isCompleteCode,
  normalizeCodeInput,
  regenerateRecoveryCodes,
} from '../../lib/mfa-client';
import { Alert } from '../ui/alert';
import { Field } from '../ui/field';
import styles from './security.module.css';

export interface ManageMfaProps {
  /** Whether this actor's role loses staff powers when MFA goes away. */
  staffRole: boolean;
  onRegenerated: (codes: string[]) => void;
  onDisabled: () => void;
}

/**
 * The two things you can do to two-factor once it is on.
 *
 * Both cost a live authenticator code, and disabling also costs the password —
 * that is the API's rule (`routes/mfa.ts`), and asking for both up front beats
 * discovering the second one via a round trip. The consequence of turning it off
 * is stated in the confirmation *before* the destructive button, not after it.
 */
export function ManageMfa({ staffRole, onRegenerated, onDisabled }: ManageMfaProps) {
  const [regenCode, setRegenCode] = useState('');
  const [regenError, setRegenError] = useState<string | null>(null);
  const [regenPending, setRegenPending] = useState(false);

  const [confirmingOff, setConfirmingOff] = useState(false);
  const [password, setPassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [disableError, setDisableError] = useState<string | null>(null);
  const [disablePending, setDisablePending] = useState(false);

  async function onRegenerate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!isCompleteCode(regenCode) || regenPending) return;
    setRegenPending(true);
    setRegenError(null);
    try {
      const codes = await regenerateRecoveryCodes(regenCode);
      setRegenCode('');
      onRegenerated(codes);
    } catch (failure) {
      setRegenError(describeMfaError(failure));
    } finally {
      setRegenPending(false);
    }
  }

  async function onDisable(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (password === '' || !isCompleteCode(disableCode) || disablePending) return;
    setDisablePending(true);
    setDisableError(null);
    try {
      await disableMfa({ password, code: disableCode });
      setPassword('');
      setDisableCode('');
      setConfirmingOff(false);
      onDisabled();
    } catch (failure) {
      setDisableError(describeMfaError(failure));
    } finally {
      setDisablePending(false);
    }
  }

  return (
    <div className={styles.manageGrid}>
      <section aria-labelledby="mfa-regen-heading" className={styles.manageCard}>
        <h3 id="mfa-regen-heading">New recovery codes</h3>
        <p>
          Makes a fresh set of ten and retires the old ones. Worth doing if you have used a few,
          or if you are not sure where the last set ended up.
        </p>
        <form className="bc-form" onSubmit={onRegenerate} noValidate>
          {regenError ? <Alert tone="error">{regenError}</Alert> : null}
          <div className="bc-field">
            <label htmlFor="mfa-regen-code">Code from your app</label>
            <input
              id="mfa-regen-code"
              className={`bc-input ${styles.codeInput}`}
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={regenCode}
              onChange={(event) => setRegenCode(normalizeCodeInput(event.target.value))}
              aria-invalid={regenError ? true : undefined}
            />
          </div>
          <button
            className="bc-button bc-button--secondary"
            type="submit"
            disabled={!isCompleteCode(regenCode) || regenPending}
          >
            {regenPending ? 'Generating…' : 'Generate new codes'}
          </button>
        </form>
      </section>

      <section aria-labelledby="mfa-disable-heading" className={styles.manageCard}>
        <h3 id="mfa-disable-heading">Turn two-factor off</h3>
        <p>
          Your account goes back to password-only. You can turn it on again whenever you like.
        </p>

        {!confirmingOff ? (
          <div className={styles.inlineActions}>
            <button
              type="button"
              className={`bc-button ${styles.destructive}`}
              onClick={() => setConfirmingOff(true)}
            >
              Turn off two-factor
            </button>
          </div>
        ) : (
          <form className="bc-form" onSubmit={onDisable} noValidate>
            <p className={styles.consequence}>
              {staffRole
                ? 'You will lose access to staff areas. The operator console checks for an MFA-backed session before it opens, so /admin will stop working for you until you turn two-factor back on and sign in again.'
                : 'Your recovery codes stop working too, and a stolen password would be enough to get into your account on its own. If you ever take a staff role, you will need two-factor back before the operator console will open.'}
            </p>
            {disableError ? <Alert tone="error">{disableError}</Alert> : null}
            <Field
              id="mfa-disable-password"
              name="password"
              label="Your password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <div className="bc-field">
              {/* Distinct from the regenerate field's label on purpose: two
                  controls with the same accessible name on one page is
                  ambiguous in a screen reader's form list. */}
              <label htmlFor="mfa-disable-code">Current code from your app</label>
              <span className="bc-field__hint" id="mfa-disable-code-hint">
                Both are needed, so that someone who only has your password — or only has your
                open laptop — cannot switch this off.
              </span>
              <input
                id="mfa-disable-code"
                className={`bc-input ${styles.codeInput}`}
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                value={disableCode}
                onChange={(event) => setDisableCode(normalizeCodeInput(event.target.value))}
                aria-invalid={disableError ? true : undefined}
                aria-describedby="mfa-disable-code-hint"
              />
            </div>
            <div className={styles.inlineActions}>
              <button
                className={`bc-button ${styles.destructive}`}
                type="submit"
                disabled={password === '' || !isCompleteCode(disableCode) || disablePending}
              >
                {disablePending ? 'Turning off…' : 'Yes, turn it off'}
              </button>
              <button
                className="bc-button bc-button--quiet"
                type="button"
                onClick={() => {
                  setConfirmingOff(false);
                  setDisableError(null);
                  setPassword('');
                  setDisableCode('');
                }}
                disabled={disablePending}
              >
                Keep two-factor on
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
