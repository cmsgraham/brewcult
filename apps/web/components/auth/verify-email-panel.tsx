'use client';

import { LocaleLink as Link } from '../../components/locale-link';
import { useEffect, useRef, useState } from 'react';
import { authApi, isApiError } from '../../lib/api';
import { useTranslate } from '../locale-provider';
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
  const t = useTranslate();
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
        // The API's own words, or null when it never got to speak. Translating
        // happens at render: `t` is only stable while a provider is above us,
        // and putting it in this effect's deps would re-run a network call on
        // every render in the case where it is not.
        setMessage(isApiError(error) ? error.userMessage : null);
        setState('failed');
      }
    })();
  }, [token]);

  if (state === 'verifying') {
    return (
      <Alert tone="info">
        <span aria-live="polite">{t('auth.verifyWorking')}</span>
      </Alert>
    );
  }

  if (state === 'verified') {
    return (
      <Alert tone="success" title={t('auth.verifyDoneTitle')}>
        {t('auth.verifyDoneOne')} <Link href="/login">{t('auth.verifyDoneLink')}</Link>{' '}
        {t('auth.verifyDoneTwo')}
      </Alert>
    );
  }

  if (state === 'failed') {
    return (
      <Alert tone="error" title={t('auth.verifyFailedTitle')}>
        {message ?? t('auth.somethingWrong')} {t('auth.verifyFailedOne')}{' '}
        <Link href="/login">{t('auth.verifyFailedLink')}</Link> {t('auth.verifyFailedTwo')}
      </Alert>
    );
  }

  return (
    <Alert tone="info" title={t('auth.verifyIdleTitle')}>
      {t('auth.verifyIdleOne')} <Link href="/login">{t('auth.verifyIdleLink')}</Link>{' '}
      {t('auth.verifyIdleTwo')}
    </Alert>
  );
}
