'use client';

import { useState, type FormEvent } from 'react';
import {
  describeMfaError,
  disableMfa,
  isCompleteCode,
  normalizeCodeInput,
  regenerateRecoveryCodes,
} from '../../lib/mfa-client';
import { useTranslate } from '../locale-provider';
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
  const t = useTranslate();
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
      setRegenError(describeMfaError(failure, t('errors.server')));
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
      setDisableError(describeMfaError(failure, t('errors.server')));
    } finally {
      setDisablePending(false);
    }
  }

  return (
    <div className={styles.manageGrid}>
      <section aria-labelledby="mfa-regen-heading" className={styles.manageCard}>
        <h3 id="mfa-regen-heading">{t('security.manage.regenHeading')}</h3>
        <p>{t('security.manage.regenBody')}</p>
        <form className="bc-form" onSubmit={onRegenerate} noValidate>
          {regenError ? <Alert tone="error">{regenError}</Alert> : null}
          <div className="bc-field">
            <label htmlFor="mfa-regen-code">{t('security.manage.codeLabel')}</label>
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
            {regenPending ? t('security.manage.generating') : t('security.manage.generate')}
          </button>
        </form>
      </section>

      <section aria-labelledby="mfa-disable-heading" className={styles.manageCard}>
        <h3 id="mfa-disable-heading">{t('security.manage.disableHeading')}</h3>
        <p>{t('security.manage.disableBody')}</p>

        {!confirmingOff ? (
          <div className={styles.inlineActions}>
            <button
              type="button"
              className={`bc-button ${styles.destructive}`}
              onClick={() => setConfirmingOff(true)}
            >
              {t('security.manage.disableStart')}
            </button>
          </div>
        ) : (
          <form className="bc-form" onSubmit={onDisable} noValidate>
            <p className={styles.consequence}>
              {staffRole
                ? t('security.manage.consequenceStaff')
                : t('security.manage.consequenceMember')}
            </p>
            {disableError ? <Alert tone="error">{disableError}</Alert> : null}
            <Field
              id="mfa-disable-password"
              name="password"
              label={t('security.manage.passwordLabel')}
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
              <label htmlFor="mfa-disable-code">{t('security.manage.disableCodeLabel')}</label>
              <span className="bc-field__hint" id="mfa-disable-code-hint">
                {t('security.manage.disableCodeHint')}
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
                {disablePending ? t('security.manage.turningOff') : t('security.manage.confirmOff')}
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
                {t('security.manage.keepOn')}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
