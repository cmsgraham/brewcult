'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { authApi, isApiError } from '../../lib/api';
import {
  isValid,
  MIN_PASSWORD_LENGTH,
  validatePassword,
  type FieldErrors,
} from '../../lib/validation';
import { Alert } from '../ui/alert';
import { Field } from '../ui/field';

type ResetField = 'password' | 'confirm';

export function ResetPasswordForm({ token }: { token: string }) {
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
      password: validatePassword(password),
      confirm: password === confirm ? undefined : 'These two do not match yet.',
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
      setFormError(
        isApiError(error)
          ? error.userMessage
          : 'Something went wrong on our side. Try again in a moment.',
      );
    } finally {
      setPending(false);
    }
  }

  if (!token) {
    return (
      <Alert tone="error" title="This link is missing its token.">
        Open the link straight from the email, or{' '}
        <Link href="/forgot-password">request a new one</Link>.
      </Alert>
    );
  }

  if (done) {
    return (
      <Alert tone="success" title="Password changed.">
        You are all set — <Link href="/login">sign in</Link> with your new password.
      </Alert>
    );
  }

  return (
    <form className="bc-form" onSubmit={onSubmit} noValidate>
      {formError ? <Alert tone="error">{formError}</Alert> : null}

      <Field
        id="reset-password"
        name="password"
        label="New password"
        type="password"
        autoComplete="new-password"
        required
        hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        error={errors.password ?? null}
      />
      <Field
        id="reset-confirm"
        name="confirm"
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        required
        error={errors.confirm ?? null}
      />

      <button className="bc-button" type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Set new password'}
      </button>
    </form>
  );
}
