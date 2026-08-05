import { type Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { NotificationPreferences } from '../../../components/profile/notification-preferences';
import { getSessionUser } from '../../../lib/server-api';

export const metadata: Metadata = {
  title: 'Email settings',
  description: 'Choose which BrewCult emails you receive.',
  robots: { index: false, follow: false },
};

/** Personal settings — never cached, never statically rendered. */
export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=%2Fprofile%2Fnotifications');

  return (
    <div className="bc-stack">
      <p className="bc-muted">
        <Link href="/profile">← Back to your profile</Link>
      </p>

      <h1>Email settings</h1>
      <p className="bc-lede">
        Everything here is off by one click, and stays off. We do not send marketing.
      </p>

      <NotificationPreferences />
    </div>
  );
}
