'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { authApi, isApiError } from '../../lib/api';
import { Alert } from '../ui/alert';

type State = 'idle' | 'verifying' | 'verified' | 'failed';

/**
 * Email confirmation.
 *
 * With a token in the URL it confirms automatically — a person who clicked the
 * link in their email has already expressed intent; making them click again is
 * friction for nothing. Without a token it explains what to do next rather than
 * showing an error, because "I landed here from a bookmark" is not a failure.
 */
export function VerifyEmailPanel({ token }: { token: string }) {
  const [state, setState] = useState<State>(token ? 'verifying' : 'idle');
  const [message, setMessage] = useState<string | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;

    void (async () => {
      try {
        await authApi.verifyEmail({ token });
        setState('verified');
      } catch (error) {
        setMessage(
          isApiError(error)
            ? error.userMessage
            : 'Something went wrong on our side. Try again in a moment.',
        );
        setState('failed');
      }
    })();
  }, [token]);

  if (state === 'verifying') {
    return (
      <Alert tone="info">
        <span aria-live="polite">Confirming your email…</span>
      </Alert>
    );
  }

  if (state === 'verified') {
    return (
      <Alert tone="success" title="Email confirmed.">
        Welcome in. <Link href="/login">Sign in</Link> and log your first brew — it takes
        about ten seconds.
      </Alert>
    );
  }

  if (state === 'failed') {
    return (
      <Alert tone="error" title="That link did not work.">
        {message ?? 'The link may have expired or already been used.'} You can{' '}
        <Link href="/login">sign in</Link> and ask for a fresh one from your profile.
      </Alert>
    );
  }

  return (
    <Alert tone="info" title="Look for the link in your inbox.">
      Confirmation links open this page and finish the job on their own. Nothing in your
      inbox after a few minutes? Check spam, then{' '}
      <Link href="/login">sign in</Link> and request another.
    </Alert>
  );
}
