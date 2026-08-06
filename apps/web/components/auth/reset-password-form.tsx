'use client';

import { LocaleLink as Link } from '../../components/locale-link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { authApi, isApiError } from '../../lib/api';
import {
  isValid,
  MIN_PASSWORD_LENGTH,
  validatePassword,
  type FieldErrors,
} from '../../lib/validation';
import { useTranslate } from '../locale-provider';
import { Alert } from '../ui/alert';
import { Field } from '../ui/field';

type ResetField = 'password' | 'confirm';

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslate();
  const router = useRouter();
  const [errors, setErrors] = useState<FieldErrors<ResetField>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get('password') ?? '');
    const confirm = String(data.get('confirm') ?? '');

    const nextErrors: FieldErrors<ResetField> = {
      password: validatePassword(t, password),
      confirm: password === confirm ? undefined : t('auth.resetMismatch'),
    };
    setErrors(nextErrors);
    setFormError(null);
    if (!isValid(nextErrors)) return;

    setPending(true);
    try {
      await authApi.confirmPasswordReset({ token, password });
      setDone(true);
      router.refresh();
    } catch (error) {
      setFormError(isApiError(error) ? error.userMessage : t('auth.somethingWrong'));
    } finally {
      setPending(false);
    }
  }

  if (!token) {
    return (
      <Alert tone="error" title={t('auth.resetNoTokenTitle')}>
        {t('auth.resetNoTokenOne')}{' '}
        <Link href="/forgot-password">{t('auth.resetNoTokenLink')}</Link>.
      </Alert>
    );
  }

  if (done) {
    return (
      <Alert tone="success" title={t('auth.resetDoneTitle')}>
        {t('auth.resetDoneOne')} <Link href="/login">{t('auth.resetDoneLink')}</Link>{' '}
        {t('auth.resetDoneTwo')}
      </Alert>
    );
  }

  return (
    <form className="bc-form" onSubmit={onSubmit} noValidate>
      {formError ? <Alert tone="error">{formError}</Alert> : null}

      <Field
        id="reset-password"
        name="password"
        label={t('auth.resetNewLabel')}
        type="password"
        autoComplete="new-password"
        required
        hint={t('auth.resetNewHint', { min: MIN_PASSWORD_LENGTH })}
        error={errors.password ?? null}
      />
      <Field
        id="reset-confirm"
        name="confirm"
        label={t('auth.resetConfirmLabel')}
        type="password"
        autoComplete="new-password"
        required
        error={errors.confirm ?? null}
      />

      <button className="bc-button" type="submit" disabled={pending}>
        {pending ? t('common.saving') : t('auth.resetSubmit')}
      </button>
    </form>
  );
}
