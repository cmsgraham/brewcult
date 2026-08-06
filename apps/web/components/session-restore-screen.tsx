'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { restoreSession } from '../lib/api';
import { localePath } from '../lib/i18n';
import { useLocale } from './locale-provider';

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
  const { locale, t } = useLocale();
  const router = useRouter();
  const attempted = useRef(false);

  // `next` arrives already in the right language — the guard that built it knew
  // which page it was protecting. `/login` itself did not, so a lapsed Spanish
  // session was sent to the English sign-in page to come back from.
  const signIn = `${localePath('/login', locale)}?next=${encodeURIComponent(next)}`;

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    void restoreSession().then((ok) => {
      if (ok) router.refresh();
      else router.replace(signIn);
    });
  }, [signIn, router]);

  return (
    <div className="bc-stack" aria-live="polite">
      {/* Deliberately quiet. This resolves in a few hundred milliseconds and is
          usually gone before it is read; anything louder would make a working
          session look like a problem. */}
      <p className="bc-muted">{t('session.restoring')}</p>
      <noscript>
        <p>
          {t('session.noScript')} <a href={signIn}>{t('common.signIn')}</a>.
        </p>
      </noscript>
    </div>
  );
}
