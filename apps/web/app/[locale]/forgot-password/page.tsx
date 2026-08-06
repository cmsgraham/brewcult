import { type Metadata } from 'next';
import { ForgotPasswordForm } from '../../../components/auth/forgot-password-form';
import { localeParam, translator } from '../../../lib/locale-server';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const t = translator(localeParam((await params).locale));
  return {
    title: t('auth.forgotTitle'),
    description: t('auth.forgotDescription'),
    robots: { index: false, follow: true },
  };
}

export default async function ForgotPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const t = translator(localeParam((await params).locale));
  return (
    <div className="bc-auth bc-stack">
      <h1>{t('auth.forgotTitle')}</h1>
      <p className="bc-muted">{t('auth.forgotLede')}</p>
      <ForgotPasswordForm />
    </div>
  );
}
