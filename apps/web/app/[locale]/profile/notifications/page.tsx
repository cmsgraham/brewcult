import { type Metadata } from 'next';
import { LocaleLink as Link } from '../../../../components/locale-link';
import { redirect } from 'next/navigation';
import { NotificationPreferences } from '../../../../components/profile/notification-preferences';
import { SessionRestoreScreen } from '../../../../components/session-restore-screen';
import { canRestoreSession, getSessionUser } from '../../../../lib/server-api';
import { localeParam, translator } from '../../../../lib/locale-server';
import { localePath } from '../../../../lib/i18n';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const t = translator(localeParam((await params).locale));
  return {
    title: t('notifications.title'),
    description: t('notifications.description'),
    robots: { index: false, follow: false },
  };
}

/** Personal settings — never cached, never statically rendered. */
export const dynamic = 'force-dynamic';

export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = localeParam((await params).locale);
  const t = translator(locale);
  const user = await getSessionUser();
  // A null user here is not proof of a stranger — the refresh cookie is
  // scoped to the auth path, so a page navigation carries nothing once the
  // access cookie has expired. Ask the browser before giving up on them.
  if (!user) {
    const self = localePath('/profile/notifications', locale);
    if (await canRestoreSession()) return <SessionRestoreScreen next={self} />;
    redirect(`${localePath('/login', locale)}?next=${encodeURIComponent(self)}`);
  }

  return (
    <div className="bc-stack">
      <p className="bc-muted">
        <Link href="/profile">{t('notifications.back')}</Link>
      </p>

      <h1>{t('notifications.title')}</h1>
      <p className="bc-lede">{t('notifications.lede')}</p>

      <NotificationPreferences />
    </div>
  );
}
