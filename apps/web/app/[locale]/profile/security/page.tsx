import { type Metadata } from 'next';
import { LocaleLink as Link } from '../../../../components/locale-link';
import { redirect } from 'next/navigation';
import { SecurityPanel } from '../../../../components/security/security-panel';
import { fetchMfaStatus } from '../../../../lib/mfa-client';
import { SessionRestoreScreen } from '../../../../components/session-restore-screen';
import { canRestoreSession, serverApiFetch } from '../../../../lib/server-api';
import { localeParam, translator } from '../../../../lib/locale-server';
import { localePath } from '../../../../lib/i18n';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const t = translator(localeParam((await params).locale));
  return {
    title: t('security.title'),
    description: t('security.description'),
    robots: { index: false, follow: false },
  };
}

/** Personal data — never cached, never statically rendered. */
export const dynamic = 'force-dynamic';

/**
 * `/profile/security` — the destination the operator console's MFA interstitial
 * links to (`admin-client.ts#MFA_SETUP_PATH`). Until this existed, an admin
 * could be promoted and then never actually use the role: the console sent them
 * to a 404.
 *
 * The status read happens on the server so the first paint already knows which
 * of the three states to show — no flash of "two-factor is off" for somebody who
 * has had it on for a year. Everything that touches a secret is in the client
 * component below.
 */
export default async function SecurityPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = localeParam((await params).locale);
  const t = translator(locale);
  const actor = await fetchMfaStatus(serverApiFetch);

  // Same reasoning as /profile: a page render cannot see a scoped refresh
  // cookie, so "no actor" may only mean "ask the browser".
  if (!actor) {
    const self = localePath('/profile/security', locale);
    if (await canRestoreSession()) return <SessionRestoreScreen next={self} />;
    redirect(`${localePath('/login', locale)}?next=${encodeURIComponent(self)}`);
  }

  return (
    <div className="bc-stack">
      <p className="bc-muted" style={{ marginBottom: 0 }}>
        <Link href="/profile">{t('security.back')}</Link>
      </p>

      <h1>{t('security.heading')}</h1>

      <p className="bc-lede">{t('security.lede')}</p>

      <SecurityPanel
        handle={actor.handle}
        role={actor.role}
        enrolled={actor.mfaEnrolled}
        sessionVerified={actor.mfaSession}
      />

      <section aria-labelledby="mfa-honest-heading" className="bc-panel bc-stack">
        <h2 id="mfa-honest-heading" style={{ marginTop: 0 }}>
          {t('security.honestHeading')}
        </h2>
        <p>{t('security.honestOne')}</p>
        <p>{t('security.honestTwo')}</p>
        <p style={{ marginBottom: 0 }}>{t('security.honestThree')}</p>
      </section>
    </div>
  );
}
