import { type Metadata } from 'next';
import { VerifyEmailPanel } from '../../components/auth/verify-email-panel';

export const metadata: Metadata = {
  title: 'Confirm your email',
  description: 'Confirm your BrewCult email address.',
  robots: { index: false, follow: false },
};

function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = firstParam(params['token']);

  return (
    <div className="bc-auth bc-stack">
      <h1>Confirm your email</h1>
      <VerifyEmailPanel token={token} />
    </div>
  );
}
