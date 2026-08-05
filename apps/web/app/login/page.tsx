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

/**
 * Why Google sign-in comes back here with query parameters.
 *
 * The OAuth callback is a server-side redirect, so it has no way to hand state
 * to the client except through the URL. Two cases arrive that way:
 *
 *   ?mfa_token=…  the account has TOTP enabled. A Google assertion is one
 *                 factor, so the callback issues a challenge instead of a
 *                 session and the form opens straight on the code step.
 *   ?error=…      the sign-in was refused. Codes come from the callback and
 *                 from resolveGoogleIdentity.
 */
const GOOGLE_ERRORS: Record<string, string> = {
  google_unavailable: 'Google sign-in is not available right now. You can sign in with your email instead.',
  google_denied: "We couldn't complete sign-in with Google. Try again, or use your email and password.",
  account_not_active: 'That account is not active. Get in touch and we will sort it out.',
  no_email: 'Google did not share an email address with us, so we could not sign you in. Use your email and password instead.',
  provider_email_unverified: 'That Google account has an unverified email address. Verify it with Google first, or sign in with your email and password.',
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, config] = await Promise.all([searchParams, fetchClientConfig()]);
  const next = safeNext(params['next']);
  const mfaToken = first(params['mfa_token']);
  const errorCode = first(params['error']);
  // An unrecognised code still says something human — never a raw code, and
  // never silence, which would look like the button simply did nothing.
  const errorMessage = errorCode
    ? (GOOGLE_ERRORS[errorCode] ??
      'We could not complete that sign-in. Try again, or use your email and password.')
    : undefined;

  return (
    <div className="bc-auth bc-stack">
      <h1>Welcome back</h1>
      <p className="bc-muted">Your brews are where you left them.</p>
      <GoogleButton enabled={config.features.googleAuth} next={next} />
      <LoginForm
        next={next}
        {...(mfaToken ? { initialMfaToken: mfaToken } : {})}
        {...(errorMessage ? { initialError: errorMessage } : {})}
      />
    </div>
  );
}
