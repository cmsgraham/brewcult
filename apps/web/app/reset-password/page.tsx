import { type Metadata } from 'next';
import { ResetPasswordForm } from '../../components/auth/reset-password-form';

export const metadata: Metadata = {
  title: 'Choose a new password',
  description: 'Set a new password for your BrewCult account.',
  robots: { index: false, follow: false },
};

function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // The token stays in the URL and goes straight to the API; it is never stored.
  const token = firstParam(params['token']);

  return (
    <div className="bc-auth bc-stack">
      <h1>Choose a new password</h1>
      <ResetPasswordForm token={token} />
    </div>
  );
}
