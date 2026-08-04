'use client';

import Link from 'next/link';
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
import { Alert } from '../ui/alert';
import { Field } from '../ui/field';

type RegisterField = 'email' | 'handle' | 'password' | 'age';

export function RegisterForm() {
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
      email: validateEmail(email),
      handle: validateHandle(handle),
      password: validatePassword(password),
      // EF §4.5 — 16+ age gate, confirmed rather than carded.
      age: ageConfirmed ? undefined : 'Please confirm you are 16 or older.',
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
      setFormError(
        isApiError(error)
          ? error.userMessage
          : 'Something went wrong on our side. Try again in a moment.',
      );
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <Alert tone="success" title="Check your email.">
        We sent you a link to confirm your address. Once you have clicked it you can{' '}
        <Link href="/login">sign in</Link>. No link after a few minutes? Look in spam, then{' '}
        <Link href="/verify-email">try again</Link>.
      </Alert>
    );
  }

  return (
    <form className="bc-form" onSubmit={onSubmit} noValidate>
      {formError ? <Alert tone="error">{formError}</Alert> : null}

      <Field
        id="register-email"
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        required
        error={errors.email ?? null}
      />
      <Field
        id="register-handle"
        name="handle"
        label="Handle"
        autoComplete="username"
        required
        hint="Lowercase letters, numbers and underscores. This is your @name."
        error={errors.handle ?? null}
      />
      <Field
        id="register-display-name"
        name="displayName"
        label="Display name (optional)"
        autoComplete="name"
        hint="What people see. You can change it any time."
        error={null}
      />
      <Field
        id="register-password"
        name="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        required
        hint={`At least ${MIN_PASSWORD_LENGTH} characters. A short sentence beats a clever squiggle.`}
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
            I am 16 or older and I accept the <Link href="/terms">Terms</Link> and{' '}
            <Link href="/privacy">Privacy Policy</Link>.
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
        <h2 style={{ fontSize: '1rem' }}>What we do with your brews</h2>
        <p style={{ marginBottom: 0 }}>
          Your brew logs build a taste profile that we use to suggest coffees and dial-in
          tweaks. That is the whole trick — nothing is sold, and there is an off switch in
          your profile. Turning it off makes suggestions blander; it does not lock you out
          of anything. You can export or delete everything whenever you like.
        </p>
      </div>

      <button className="bc-button" type="submit" disabled={pending}>
        {pending ? 'Creating your account…' : 'Create account'}
      </button>

      <p className="bc-muted" style={{ fontSize: '0.9rem' }}>
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </form>
  );
}
