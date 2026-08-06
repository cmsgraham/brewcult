import { type Metadata } from 'next';
import { ResetPasswordForm } from '../../../components/auth/reset-password-form';
import { localeParam, translator } from '../../../lib/locale-server';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const t = translator(localeParam((await params).locale));
  return {
    title: t('auth.resetTitle'),
    description: t('auth.resetDescription'),
    robots: { index: false, follow: false },
  };
}

function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

export default async function ResetPasswordPage({
  params: routeParams,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, params] = await Promise.all([routeParams, searchParams]);
  const t = translator(localeParam(locale));
  // The token stays in the URL and goes straight to the API; it is never stored.
  const token = firstParam(params['token']);

  return (
    <div className="bc-auth bc-stack">
      <h1>{t('auth.resetTitle')}</h1>
      <ResetPasswordForm token={token} />
    </div>
  );
}
