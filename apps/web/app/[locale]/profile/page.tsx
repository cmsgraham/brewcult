import { type Metadata } from 'next';
import { LocaleLink as Link } from '../../../components/locale-link';
import { redirect } from 'next/navigation';
import { AvatarEditor } from '../../../components/media/avatar-editor';
import { AccountActions } from '../../../components/profile/account-actions';
import { AddCoffee } from '../../../components/coffee/add-coffee';
import { EquipmentManager } from '../../../components/profile/equipment-manager';
import { SignOutButton } from '../../../components/profile/sign-out-button';
import { Alert } from '../../../components/ui/alert';
import { fetchClientConfig } from '../../../lib/client-config';
import { readAvatarUrl } from '../../../lib/media-client';
import { SessionRestoreScreen } from '../../../components/session-restore-screen';
import { canRestoreSession, getSessionUser } from '../../../lib/server-api';
import { localeParam, translator } from '../../../lib/locale-server';
import { localePath } from '../../../lib/i18n';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const t = translator(localeParam((await params).locale));
  return {
    title: t('profile.title'),
    description: t('profile.description'),
    robots: { index: false, follow: false },
  };
}

/** Personal data — never cached, never statically rendered. */
export const dynamic = 'force-dynamic';

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = localeParam((await params).locale);
  const t = translator(locale);
  const [user, config] = await Promise.all([getSessionUser(), fetchClientConfig()]);

  // A null user here is not proof of a stranger — the refresh cookie is
  // scoped to the auth path, so a page navigation carries nothing once the
  // access cookie has expired. Ask the browser before giving up on them.
  if (!user) {
    const self = localePath('/profile', locale);
    if (await canRestoreSession()) return <SessionRestoreScreen next={self} />;
    redirect(`${localePath('/login', locale)}?next=${encodeURIComponent(self)}`);
  }

  return (
    <div className="bc-stack">
      <h1>{user.displayName ?? user.handle}</h1>
      <p className="bc-muted">
        @{user.handle} · {user.email}
        {user.emailVerified === false ? ` · ${t('profile.emailUnconfirmed')}` : ''}
      </p>

      {/* Sign out sits up here, next to who you are, and deliberately NOWHERE
          NEAR the delete button further down: those two are not neighbours you
          want on a small screen. Until now the only sign-out in the product was
          buried in the security panel, which meant no discoverable way to leave
          on a shared device. */}
      <div className="bc-actions" style={{ marginTop: 0 }}>
        <SignOutButton />
      </div>

      {user.emailVerified === false ? (
        <Alert tone="info" title={t('profile.verifyTitle')}>
          {t('profile.verifyBody')}{' '}
          <Link href="/verify-email">{t('profile.verifyLink')}</Link>.
        </Alert>
      ) : null}

      {/* Read tolerantly: the avatar field's exact spelling is still settling on
          the API side, and an absent one simply means initials. */}
      <section aria-labelledby="photo-heading" className="bc-stack">
        <h2 id="photo-heading">{t('profile.photoHeading')}</h2>
        <AvatarEditor
          initialUrl={readAvatarUrl(user)}
          displayName={user.displayName ?? null}
          handle={user.handle}
        />
      </section>

      {/* The MFA page has existed since ID-07 with no entry point anywhere in
          the product — you could only reach it from the operator console's
          interstitial. This is that entry point. */}
      {/* Every feature needs a way in (second_draft §30.4): a preferences screen
          nobody can find is a preferences screen nobody uses, and the only
          other route to it is the footer of an email they may have deleted. */}
      <section aria-labelledby="email-heading" className="bc-stack">
        <h2 id="email-heading">{t('profile.emailHeading')}</h2>
        <p className="bc-muted">{t('profile.emailBody')}</p>
        <p>
          <Link className="bc-button bc-button--secondary" href="/profile/notifications">
            {t('profile.emailSettings')}
          </Link>
        </p>
      </section>

      <section aria-labelledby="security-heading" className="bc-stack">
        <h2 id="security-heading">{t('profile.securityHeading')}</h2>
        <p className="bc-muted">{t('profile.securityBody')}</p>
        <p style={{ marginBottom: 0 }}>
          <Link href="/profile/security">{t('profile.twoFactorLink')}</Link>
        </p>
      </section>

      <section aria-labelledby="brews-heading" className="bc-stack">
        <h2 id="brews-heading">{t('history.title')}</h2>
        <p className="bc-muted">{t('history.lede')}</p>
        <p>
          <Link className="bc-button bc-button--quiet" href="/brew/history">
            {t('profile.seeBrews')}
          </Link>
        </p>
      </section>

      <section aria-labelledby="equipment-heading" className="bc-stack">
        <h2 id="equipment-heading">{t('profile.equipmentHeading')}</h2>
        <p className="bc-muted">{t('profile.equipmentBody')}</p>
        <EquipmentManager />
      </section>

      <section aria-labelledby="shelf-heading" className="bc-stack">
        <h2 id="shelf-heading">{t('profile.coffeeHeading')}</h2>
        <p className="bc-muted" style={{ marginBottom: 0 }}>
          {t('profile.coffeeBody')}
        </p>
        <AddCoffee compact />
      </section>

      {/* EF §4.5 — plainly worded, at the place where the switch will live. */}
      <section aria-labelledby="personalisation-heading" className="bc-panel bc-stack">
        <h2 id="personalisation-heading">{t('profile.personalisationHeading')}</h2>
        <p>{t('profile.personalisationOne')}</p>
        <p>{t('profile.personalisationTwo')}</p>
        <p style={{ marginBottom: 0 }}>
          {t('profile.personalisationThree')}{' '}
          <Link href="/privacy">{t('profile.privacyLink')}</Link>{' '}
          {t('profile.personalisationThreeEnd')}
        </p>
      </section>

      <section aria-labelledby="data-heading" className="bc-stack">
        <h2 id="data-heading">{t('profile.dataHeading')}</h2>
        <p className="bc-muted">{t('profile.dataBody')}</p>
        <AccountActions
          userId={user.id}
          exportEnabled={config.features.accountExport}
          deletionEnabled={config.features.accountDeletion}
        />
      </section>
    </div>
  );
}
