'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { hasSessionHint, restoreSession } from '../lib/api';

/**
 * Puts a signed-in person back where they belong, on a cold page load.
 *
 * ── THE PROBLEM THIS SOLVES ─────────────────────────────────────────────────
 * The refresh cookie is scoped to the auth path, deliberately: the long-lived
 * credential is not attached to ordinary traffic. The consequence is that a
 * page navigation carries NOTHING once the 15-minute access cookie has expired
 * — not an expired token, not the refresh token, nothing. The server render
 * therefore cannot tell a returning member from a stranger, draws the
 * signed-out nav, and `/profile` bounces to `/login`.
 *
 * Production said so plainly: 19 sign-ins in a week and exactly ONE refresh.
 * The rotation machinery was correct and almost never ran, so every visit
 * after fifteen minutes was a fresh login.
 *
 * ── WHAT IT DOES ────────────────────────────────────────────────────────────
 * On mount, if the readable hint says a session exists but the server rendered
 * as though it does not, it calls the one endpoint the refresh cookie IS sent
 * to, then asks Next to re-render the server components — which now see a
 * fresh access cookie.
 *
 * ── WHY IT CANNOT LOOP ──────────────────────────────────────────────────────
 * `attempted` is a ref, not state: `router.refresh()` re-renders this component
 * without remounting it, so a ref survives exactly the event that would
 * otherwise start the cycle again. And a failed refresh forgets the hint, so
 * the next load does not try at all.
 */
export function SessionRestorer({ restorable }: { restorable: boolean }) {
  const router = useRouter();
  const attempted = useRef(false);

  useEffect(() => {
    // `restorable` is the server's half of the decision (a hint, but no access
    // cookie); `hasSessionHint()` re-checks in the browser, which is what
    // notices a hint that a failed attempt has since deleted.
    if (!restorable || attempted.current || !hasSessionHint()) return;
    attempted.current = true;
    void restoreSession().then((ok) => {
      // Only on success: a pointless re-render of a genuinely signed-out page
      // costs a round trip and changes nothing on screen.
      if (ok) router.refresh();
    });
  }, [restorable, router]);

  return null;
}
