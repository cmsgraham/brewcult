'use client';

import { useLocale } from '../locale-provider';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authApi } from '../../lib/api';
import { localePath } from '../../lib/i18n';

/**
 * Sign out.
 *
 * There was no way to do this anywhere in the product. The only sign-out
 * control lived inside the security panel at /profile/security, and it was put
 * there to unstick one specific MFA dead end — not as the way out of the app.
 * So a signed-in person had no discoverable way to leave, which matters most on
 * a shared or borrowed device.
 *
 * `POST /v1/auth/logout` revokes the whole refresh-token family, so this ends
 * the session server-side rather than just dropping cookies locally.
 */
export function SignOutButton() {
  const { locale, t } = useLocale();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function endSession(): Promise<void> {
    setPending(true);
    try {
      await authApi.logout();
    } catch {
      // A failed logout must never strand somebody on a page they are trying to
      // leave. Send them to sign-in regardless; that page resolves whatever
      // session does or does not still exist, and the cookies are gone either
      // way once the server has answered.
    }
    // In the language they were reading. Signing out is the one moment where
    // landing on an English page reads as "the site logged me out AND broke".
    router.push(localePath('/login', locale));
    router.refresh();
  }

  return (
    <button
      type="button"
      className="bc-button bc-button--secondary"
      onClick={endSession}
      disabled={pending}
    >
      {pending ? '…' : t('common.signOut')}
    </button>
  );
}
