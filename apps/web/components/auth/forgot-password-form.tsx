'use client';

import { LocaleLink as Link } from '../../components/locale-link';
import { useState, type FormEvent } from 'react';
import { authApi, isApiError } from '../../lib/api';
import { isValid, validateEmail, type FieldErrors } from '../../lib/validation';
import { useTranslate } from '../locale-provider';
import { Alert } from '../ui/alert';
import { Field } from '../ui/field';

export function ForgotPasswordForm() {
  const t = useTranslate();
  const [errors, setErrors] = useState<FieldErrors<'email'>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get('email') ?? '');

    const nextErrors: FieldErrors<'email'> = { email: validateEmail(t, email) };
    setErrors(nextErrors);
    setFormError(null);
    if (!isValid(nextErrors)) return;

    setPending(true);
    try {
      await authApi.requestPasswordReset({ email: email.trim() });
      setSent(true);
    } catch (error) {
      // A 404 here would leak which addresses exist, so the API is expected to
      // answer 204 either way. Anything else is a genuine failure.
      setFormError(isApiError(error) ? error.userMessage : t('auth.somethingWrong'));
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <Alert tone="success" title={t('auth.forgotSentTitle')}>
        {t('auth.forgotSentBody')}
      </Alert>
    );
  }

  return (
    <form className="bc-form" onSubmit={onSubmit} noValidate>
      {formError ? <Alert tone="error">{formError}</Alert> : null}

      <Field
        id="forgot-email"
        name="email"
        label={t('auth.emailLabel')}
        type="email"
        autoComplete="email"
        required
        hint={t('auth.forgotEmailHint')}
        error={errors.email ?? null}
      />

      <button className="bc-button" type="submit" disabled={pending}>
        {pending ? t('auth.forgotSending') : t('auth.forgotSubmit')}
      </button>

      <p className="bc-muted" style={{ fontSize: '0.9rem' }}>
        {t('auth.forgotRemembered')} <Link href="/login">{t('auth.forgotBackToSignIn')}</Link>
      </p>
    </form>
  );
}
