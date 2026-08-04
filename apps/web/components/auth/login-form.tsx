'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { authApi, isApiError } from '../../lib/api';
import { isValid, validateEmail, validateRequired, type FieldErrors } from '../../lib/validation';
import { Alert } from '../ui/alert';
import { Field } from '../ui/field';

type LoginField = 'email' | 'password';

export function LoginForm({ next = '/profile' }: { next?: string }) {
  const router = useRouter();
  const [errors, setErrors] = useState<FieldErrors<LoginField>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get('email') ?? '');
    const password = String(data.get('password') ?? '');

    const nextErrors: FieldErrors<LoginField> = {
      email: validateEmail(email),
      password: validateRequired(password, 'Password'),
    };
    setErrors(nextErrors);
    setFormError(null);
    if (!isValid(nextErrors)) return;

    setPending(true);
    try {
      await authApi.login({ email: email.trim(), password });
      router.push(next);
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

  return (
    <form className="bc-form" onSubmit={onSubmit} noValidate>
      {formError ? <Alert tone="error">{formError}</Alert> : null}

      <Field
        id="login-email"
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        required
        error={errors.email ?? null}
      />
      <Field
        id="login-password"
        name="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        error={errors.password ?? null}
      />

      <button className="bc-button" type="submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>

      <p className="bc-muted" style={{ fontSize: '0.9rem' }}>
        <Link href="/forgot-password">Forgot your password?</Link> · New here?{' '}
        <Link href="/register">Create an account</Link>
      </p>
    </form>
  );
}
