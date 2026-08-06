import { type Metadata } from 'next';
import { VerifyEmailPanel } from '../../../components/auth/verify-email-panel';
import { localeParam, translator } from '../../../lib/locale-server';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const t = translator(localeParam((await params).locale));
  return {
    title: t('auth.verifyTitle'),
    description: t('auth.verifyDescription'),
    robots: { index: false, follow: false },
  };
}

function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

export default async function VerifyEmailPage({
  params: routeParams,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, params] = await Promise.all([routeParams, searchParams]);
  const t = translator(localeParam(locale));
  const token = firstParam(params['token']);

  return (
    <div className="bc-auth bc-stack">
      <h1>{t('auth.verifyTitle')}</h1>
      <VerifyEmailPanel token={token} />
    </div>
  );
}
