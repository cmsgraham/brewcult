'use client';

import { LocaleLink as Link } from '../../components/locale-link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { authApi, isApiError } from '../../lib/api';
import {
  isValid,
  MIN_PASSWORD_LENGTH,
  validateEmail,
  validateHandle,
  validatePassword,
  type FieldErrors,
} from '../../lib/validation';
import { useTranslate } from '../locale-provider';
import { Alert } from '../ui/alert';
import { Field } from '../ui/field';

type RegisterField = 'email' | 'handle' | 'password' | 'age';

export function RegisterForm() {
  const t = useTranslate();
  const router = useRouter();
  const [errors, setErrors] = useState<FieldErrors<RegisterField>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get('email') ?? '');
    const handle = String(data.get('handle') ?? '');
    const displayName = String(data.get('displayName') ?? '');
    const password = String(data.get('password') ?? '');
    const ageConfirmed = data.get('age') === 'on';

    const nextErrors: FieldErrors<RegisterField> = {
      email: validateEmail(t, email),
      handle: validateHandle(t, handle),
      password: validatePassword(t, password),
      // EF §4.5 — 16+ age gate, confirmed rather than carded.
      age: ageConfirmed ? undefined : t('auth.ageUnconfirmed'),
    };
    setErrors(nextErrors);
    setFormError(null);
    if (!isValid(nextErrors)) return;

    setPending(true);
    try {
      await authApi.register({
        email: email.trim(),
        handle: handle.trim().toLowerCase(),
        password,
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
      });
      setDone(true);
      router.refresh();
    } catch (error) {
      setFormError(isApiError(error) ? error.userMessage : t('auth.somethingWrong'));
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <Alert tone="success" title={t('auth.registeredTitle')}>
        {t('auth.registeredOne')}{' '}
        <Link href="/login">{t('auth.registeredSignIn')}</Link>
        {t('auth.registeredTwo')}{' '}
        <Link href="/verify-email">{t('auth.registeredRetry')}</Link>.
      </Alert>
    );
  }

  return (
    <form className="bc-form" onSubmit={onSubmit} noValidate>
      {formError ? <Alert tone="error">{formError}</Alert> : null}

      <Field
        id="register-email"
        name="email"
        label={t('auth.emailLabel')}
        type="email"
        autoComplete="email"
        required
        error={errors.email ?? null}
      />
      <Field
        id="register-handle"
        name="handle"
        label={t('auth.handleLabel')}
        autoComplete="username"
        required
        hint={t('auth.handleHint')}
        error={errors.handle ?? null}
      />
      <Field
        id="register-display-name"
        name="displayName"
        label={t('auth.displayNameLabel')}
        autoComplete="name"
        hint={t('auth.displayNameHint')}
        error={null}
      />
      <Field
        id="register-password"
        name="password"
        label={t('auth.passwordLabel')}
        type="password"
        autoComplete="new-password"
        required
        hint={t('auth.newPasswordHint', { min: MIN_PASSWORD_LENGTH })}
        error={errors.password ?? null}
      />

      <div className="bc-field">
        <label htmlFor="register-age" style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            id="register-age"
            name="age"
            type="checkbox"
            aria-invalid={errors.age ? true : undefined}
            aria-describedby={errors.age ? 'register-age-error' : undefined}
          />
          <span>
            {t('auth.agePre')} <Link href="/terms">{t('auth.ageTerms')}</Link>{' '}
            {t('auth.ageMid')} <Link href="/privacy">{t('auth.agePrivacy')}</Link>.
          </span>
        </label>
        {errors.age ? (
          <span className="bc-field__error" id="register-age-error">
            {errors.age}
          </span>
        ) : null}
      </div>

      {/* EF §4.5 — personalisation disclosed plainly, at the moment of signup. */}
      <div className="bc-panel" style={{ fontSize: '0.92rem' }}>
        <h2 style={{ fontSize: '1rem' }}>{t('auth.personalisationHeading')}</h2>
        <p style={{ marginBottom: 0 }}>{t('auth.personalisationBody')}</p>
      </div>

      <button className="bc-button" type="submit" disabled={pending}>
        {pending ? t('auth.creating') : t('auth.createAccount')}
      </button>

      <p className="bc-muted" style={{ fontSize: '0.9rem' }}>
        {t('auth.haveAccount')} <Link href="/login">{t('common.signIn')}</Link>
      </p>
    </form>
  );
}
