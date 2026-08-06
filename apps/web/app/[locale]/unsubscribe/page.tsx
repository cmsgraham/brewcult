import { type Metadata } from 'next';
import { LocaleLink as Link } from '../../../components/locale-link';
import { UnsubscribeConfirm } from '../../../components/profile/unsubscribe-confirm';

export const metadata: Metadata = {
  title: 'Unsubscribed',
  description: 'You will not get that kind of email from BrewCult again.',
  robots: { index: false, follow: false },
};

/**
 * Where the link in an email lands.
 *
 * No sign-in required, by design: somebody trying to stop email should not first
 * have to remember a password. The token in the URL authorises exactly one
 * thing — turning one kind of email off — and nothing else (see the API's
 * unsubscribe.ts).
 *
 * The work happens client-side rather than in this server component on purpose.
 * Mailbox providers and corporate scanners PREFETCH links in mail; a GET that
 * changed state during render would unsubscribe people who never clicked.
 * Gmail's own one-click path uses POST for this reason, and so does this page.
 */
export const dynamic = 'force-dynamic';

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params['token'];
  const token = Array.isArray(raw) ? raw[0] : raw;

  return (
    <div className="bc-auth bc-stack">
      <h1>Email settings</h1>
      <UnsubscribeConfirm token={token ?? null} />
      <p className="bc-muted">
        Changed your mind, or want finer control? <Link href="/profile/notifications">Your
        email settings</Link> has a switch for each kind.
      </p>
    </div>
  );
}
