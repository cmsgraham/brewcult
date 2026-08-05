import { type Metadata } from 'next';
import { GoogleButton } from '../../components/auth/google-button';
import { RegisterForm } from '../../components/auth/register-form';
import { fetchClientConfig } from '../../lib/client-config';

export const metadata: Metadata = {
  title: 'Create an account',
  description:
    'Join BrewCult. Beginners welcome — every great brewer started with bitter coffee.',
  robots: { index: false, follow: true },
};

export default async function RegisterPage() {
  const config = await fetchClientConfig();

  return (
    <div className="bc-auth bc-stack">
      <h1>Start where you are</h1>
      {/* second_draft §9.7 — norms shown at the point of action, not buried in guidelines. */}
      <p className="bc-muted">
        Every great brewer started with bitter coffee. Beginner questions are welcome here,
        whatever gear is on your counter.
      </p>
      {/* "Sign up with Google" is the approved wording for a registration
          context; the sign-in page keeps the default. */}
      <GoogleButton enabled={config.features.googleAuth} label="Sign up with Google" />
      <RegisterForm />
    </div>
  );
}
