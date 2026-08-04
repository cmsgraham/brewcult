import { type Metadata } from 'next';
import { GoogleButton } from '../../components/auth/google-button';
import { LoginForm } from '../../components/auth/login-form';
import { fetchClientConfig } from '../../lib/client-config';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to BrewCult.',
  robots: { index: false, follow: true },
};

/** Only same-site paths survive, so `?next=` can never be an open redirect. */
function safeNext(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate && candidate.startsWith('/') && !candidate.startsWith('//')) {
    return candidate;
  }
  return '/profile';
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, config] = await Promise.all([searchParams, fetchClientConfig()]);
  const next = safeNext(params['next']);

  return (
    <div className="bc-auth bc-stack">
      <h1>Welcome back</h1>
      <p className="bc-muted">Your brews are where you left them.</p>
      <GoogleButton enabled={config.features.googleAuth} next={next} />
      <LoginForm next={next} />
    </div>
  );
}
