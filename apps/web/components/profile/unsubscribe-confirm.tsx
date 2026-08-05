'use client';

import { useEffect, useRef, useState } from 'react';
import { unsubscribeWithToken } from '../../lib/notifications-client';
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
      <Alert tone="info" title="Nothing to change.">
        That link is missing its code. Open your email settings to choose which messages you
        get.
      </Alert>
    );
  }

  if (state === 'working') {
    return (
      <p className="bc-muted" role="status">
        Updating your settings…
      </p>
    );
  }

  return (
    <Alert tone="success" title="Done — you are unsubscribed.">
      You will not get that kind of email from us again. Security emails, like sign-in codes
      and password changes, still come through: those are how you find out if someone else is
      using your account.
    </Alert>
  );
}
