'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { authApi, isApiError } from '../../lib/api';
import { isValid, validateEmail, validateRequired, type FieldErrors } from '../../lib/validation';
import { Alert } from '../ui/alert';
import { Field } from '../ui/field';

type LoginField = 'email' | 'password';

export function LoginForm({
  next = '/profile',
  initialMfaToken,
  initialError,
}: {
  next?: string;
  /**
   * Set when Google sign-in bounced back needing a second factor. The OAuth
   * callback is a server redirect and cannot hand state to the client any other
   * way, so the challenge arrives as a query param and opens leg two directly.
   */
  initialMfaToken?: string;
  /** A message from a failed Google round trip, already made human upstream. */
  initialError?: string;
}) {
  const router = useRouter();
  const [errors, setErrors] = useState<FieldErrors<LoginField>>({});
  const [formError, setFormError] = useState<string | null>(initialError ?? null);
  const [pending, setPending] = useState(false);
  /**
   * Leg two of the login. The API answers an MFA-enrolled account with
   * `{ mfa_required, mfa_token }` instead of a session; we hold that token in
   * component state (never storage — it is short-lived and single-purpose) and
   * exchange it for a session once the code is in.
   */
  const [mfaToken, setMfaToken] = useState<string | null>(initialMfaToken ?? null);
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);

  function finish() {
    router.push(next);
    router.refresh();
  }

  function describe(error: unknown): string {
    return isApiError(error)
      ? error.userMessage
      : 'Something went wrong on our side. Try again in a moment.';
  }

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
      const result = await authApi.login({ email: email.trim(), password });
      if (result?.mfa_required && result.mfa_token) {
        setMfaToken(result.mfa_token);
        return;
      }
      finish();
    } catch (error) {
      setFormError(describe(error));
    } finally {
      setPending(false);
    }
  }

  async function onVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mfaToken) return;
    const value = String(new FormData(event.currentTarget).get('code') ?? '').trim();
    if (!value) {
      setFormError(useRecoveryCode ? 'Enter a recovery code.' : 'Enter the 6-digit code.');
      return;
    }

    setFormError(null);
    setPending(true);
    try {
      await authApi.mfaVerify({
        mfa_token: mfaToken,
        ...(useRecoveryCode ? { recovery_code: value } : { code: value }),
      });
      finish();
    } catch (error) {
      setFormError(describe(error));
    } finally {
      setPending(false);
    }
  }

  if (mfaToken) {
    return (
      // key: without it React reconciles this against the credentials form and
      // reuses the password <input> as the code field — carrying the typed
      // password into a visible text box.
      <form key="mfa-step" className="bc-form" onSubmit={onVerify} noValidate>
        {formError ? <Alert tone="error">{formError}</Alert> : null}

        <p className="bc-muted">
          {useRecoveryCode
            ? 'Enter one of the recovery codes you saved when you set up two-factor authentication.'
            : 'Open your authenticator app and enter the current 6-digit code.'}
        </p>

        <Field
          id="login-mfa-code"
          name="code"
          label={useRecoveryCode ? 'Recovery code' : 'Authentication code'}
          type="text"
          inputMode={useRecoveryCode ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          autoFocus
          required
          error={null}
        />

        <button className="bc-button" type="submit" disabled={pending}>
          {pending ? 'Checking…' : 'Verify and sign in'}
        </button>

        <p className="bc-muted" style={{ fontSize: '0.9rem' }}>
          <button
            type="button"
            className="bc-link-button"
            onClick={() => {
              setUseRecoveryCode((value) => !value);
              setFormError(null);
            }}
          >
            {useRecoveryCode ? 'Use your authenticator app instead' : 'Lost your device? Use a recovery code'}
          </button>
          {' · '}
          <button
            type="button"
            className="bc-link-button"
            onClick={() => {
              setMfaToken(null);
              setUseRecoveryCode(false);
              setFormError(null);
            }}
          >
            Start over
          </button>
        </p>
      </form>
    );
  }

  return (
    <form key="credentials-step" className="bc-form" onSubmit={onSubmit} noValidate>
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
