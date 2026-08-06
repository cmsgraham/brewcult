import { type Metadata } from 'next';
import { GoogleButton } from '../../../components/auth/google-button';
import { LoginForm } from '../../../components/auth/login-form';
import { fetchClientConfig } from '../../../lib/client-config';
import { localeParam, translator } from '../../../lib/locale-server';
import { localePath, type Locale, type MessageKey } from '../../../lib/i18n';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const t = translator(localeParam((await params).locale));
  return {
    title: t('auth.signInTitle'),
    description: t('auth.signInDescription'),
    robots: { index: false, follow: true },
  };
}

/**
 * Only same-site paths survive, so `?next=` can never be an open redirect.
 *
 * The fallback is locale-aware: signing in at `/es/login` with nothing to come
 * back to used to land on the English `/profile`, which is the "Spanish until
 * you click something" bug arriving at the worst possible moment. A supplied
 * `?next=` is left exactly as it came — the guard that built it already knows
 * which language the person was reading.
 */
function safeNext(value: string | string[] | undefined, locale: Locale): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate && candidate.startsWith('/') && !candidate.startsWith('//')) {
    return candidate;
  }
  return localePath('/profile', locale);
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
 *
 * The map holds message KEYS rather than sentences, so a refusal is explained
 * in the language the person is reading — the redirect lands on `/es/login` and
 * the reason it gives has to arrive in Spanish too.
 */
const GOOGLE_ERRORS: Record<string, MessageKey> = {
  google_unavailable: 'auth.googleUnavailable',
  google_denied: 'auth.googleDenied',
  account_not_active: 'auth.googleNotActive',
  no_email: 'auth.googleNoEmail',
  provider_email_unverified: 'auth.googleUnverified',
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({
  params: routeParams,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale: rawLocale }, params, config] = await Promise.all([
    routeParams,
    searchParams,
    fetchClientConfig(),
  ]);
  const locale = localeParam(rawLocale);
  const t = translator(locale);
  const next = safeNext(params['next'], locale);
  const mfaToken = first(params['mfa_token']);
  const errorCode = first(params['error']);
  // An unrecognised code still says something human — never a raw code, and
  // never silence, which would look like the button simply did nothing.
  const errorMessage = errorCode
    ? t(GOOGLE_ERRORS[errorCode] ?? 'auth.googleUnknown')
    : undefined;

  return (
    <div className="bc-auth bc-stack">
      <h1>{t('auth.signInHeading')}</h1>
      <p className="bc-muted">{t('auth.signInLede')}</p>
      <GoogleButton enabled={config.features.googleAuth} next={next} locale={locale} />
      <LoginForm
        next={next}
        {...(mfaToken ? { initialMfaToken: mfaToken } : {})}
        {...(errorMessage ? { initialError: errorMessage } : {})}
      />
    </div>
  );
}
