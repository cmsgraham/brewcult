import { type Metadata } from 'next';
import { GoogleButton } from '../../../components/auth/google-button';
import { RegisterForm } from '../../../components/auth/register-form';
import { fetchClientConfig } from '../../../lib/client-config';
import { localeParam, translator } from '../../../lib/locale-server';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const t = translator(localeParam((await params).locale));
  return {
    title: t('auth.registerTitle'),
    description: t('auth.registerDescription'),
    robots: { index: false, follow: true },
  };
}

export default async function RegisterPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const [{ locale: rawLocale }, config] = await Promise.all([params, fetchClientConfig()]);
  const locale = localeParam(rawLocale);
  const t = translator(locale);

  return (
    <div className="bc-auth bc-stack">
      <h1>{t('auth.registerHeading')}</h1>
      {/* second_draft §9.7 — norms shown at the point of action, not buried in guidelines. */}
      <p className="bc-muted">{t('auth.registerLede')}</p>
      {/* "Sign up with Google" is the approved wording for a registration
          context; the sign-in page keeps the default. */}
      <GoogleButton
        enabled={config.features.googleAuth}
        locale={locale}
        wording="signUp"
      />
      <RegisterForm />
    </div>
  );
}
