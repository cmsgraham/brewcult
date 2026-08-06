'use client';

import { useEffect, useRef, useState } from 'react';
import { unsubscribeWithToken } from '../../lib/notifications-client';
import { useTranslate } from '../locale-provider';
import { Alert } from '../ui/alert';

type State = 'working' | 'done' | 'no_token';

/**
 * Performs the unsubscribe with a POST once the page is open in a real browser.
 *
 * Why not do it during the server render: link scanners and mail clients
 * prefetch URLs, and a GET that mutates would silently unsubscribe people who
 * never clicked. Requiring a POST issued after hydration means a human (or
 * Gmail's explicit one-click flow, which also POSTs) actually asked.
 *
 * There is no failure state on purpose. The API answers 200 for a valid and an
 * invalid token alike, so somebody who is only trying to stop email is never
 * told they did it wrong — and a prober learns nothing about which tokens are
 * real. Anything genuinely broken shows up in our logs, not in their face.
 */
export function UnsubscribeConfirm({ token }: { token: string | null }) {
  const t = useTranslate();
  const [state, setState] = useState<State>(token ? 'working' : 'no_token');
  const fired = useRef(false);

  useEffect(() => {
    if (!token || fired.current) return;
    fired.current = true; // StrictMode double-invokes effects in development
    unsubscribeWithToken(token)
      .catch(() => undefined)
      .finally(() => setState('done'));
  }, [token]);

  if (state === 'no_token') {
    return (
      <Alert tone="info" title={t('unsubscribePage.noTokenTitle')}>
        {t('unsubscribePage.noTokenBody')}
      </Alert>
    );
  }

  if (state === 'working') {
    return (
      <p className="bc-muted" role="status">
        {t('unsubscribePage.working')}
      </p>
    );
  }

  return (
    <Alert tone="success" title={t('unsubscribePage.doneTitle')}>
      {t('unsubscribePage.doneBody')}
    </Alert>
  );
}
