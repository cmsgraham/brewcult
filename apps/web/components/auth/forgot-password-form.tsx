'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { authApi, isApiError } from '../../lib/api';
import { isValid, validateEmail, type FieldErrors } from '../../lib/validation';
import { Alert } from '../ui/alert';
import { Field } from '../ui/field';

export function ForgotPasswordForm() {
  const [errors, setErrors] = useState<FieldErrors<'email'>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get('email') ?? '');

    const nextErrors: FieldErrors<'email'> = { email: validateEmail(email) };
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
      setFormError(
        isApiError(error)
          ? error.userMessage
          : 'Something went wrong on our side. Try again in a moment.',
      );
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <Alert tone="success" title="Check your email.">
        If that address has a BrewCult account, a reset link is on its way. The link works
        once and expires shortly — request another any time.
      </Alert>
    );
  }

  return (
    <form className="bc-form" onSubmit={onSubmit} noValidate>
      {formError ? <Alert tone="error">{formError}</Alert> : null}

      <Field
        id="forgot-email"
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        required
        hint="We will send a link that lets you set a new password."
        error={errors.email ?? null}
      />

      <button className="bc-button" type="submit" disabled={pending}>
        {pending ? 'Sending…' : 'Send reset link'}
      </button>

      <p className="bc-muted" style={{ fontSize: '0.9rem' }}>
        Remembered it? <Link href="/login">Back to sign in</Link>
      </p>
    </form>
  );
}
