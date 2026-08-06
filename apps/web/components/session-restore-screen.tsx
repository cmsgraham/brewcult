'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { restoreSession } from '../lib/api';
import { useTranslate } from './locale-provider';

/**
 * What a private page shows instead of bouncing you to /login.
 *
 * A page that redirects has already decided you are a stranger — and it decides
 * that from a request the browser could not attach a credential to, because the
 * refresh cookie is scoped to the auth path. The redirect then navigates away
 * before any browser code can prove otherwise. That is the whole bug: a valid
 * month-long session, thrown away by a page render that had no way to see it.
 *
 * So: pause here, ask the browser, and go to /login only if the answer is no.
 */
export function SessionRestoreScreen({ next }: { next: string }) {
  const t = useTranslate();
  const router = useRouter();
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    void restoreSession().then((ok) => {
      if (ok) router.refresh();
      else router.replace(`/login?next=${encodeURIComponent(next)}`);
    });
  }, [next, router]);

  return (
    <div className="bc-stack" aria-live="polite">
      {/* Deliberately quiet. This resolves in a few hundred milliseconds and is
          usually gone before it is read; anything louder would make a working
          session look like a problem. */}
      <p className="bc-muted">{t('session.restoring')}</p>
      <noscript>
        <p>
          {t('session.noScript')}{' '}
          <a href={`/login?next=${encodeURIComponent(next)}`}>{t('common.signIn')}</a>.
        </p>
      </noscript>
    </div>
  );
}
