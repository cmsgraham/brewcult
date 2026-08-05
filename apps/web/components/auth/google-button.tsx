import { GOOGLE_OAUTH_START } from '../../lib/api';

/**
 * "Sign in with Google" (deployment_guide §7.2), built to Google's Identity
 * branding guidelines rather than styled to taste.
 *
 * Google's terms are prescriptive about this button, and a home-made version is
 * a real risk: an OAuth app can be rejected at verification for not using the
 * approved mark. The rules honoured here:
 *
 *   - the official four-colour "G", never recoloured, never on a coloured tile
 *   - 40px tall, 18px logo, 4px radius, 12px side padding
 *   - light: #FFFFFF on a #747775 hairline with #1F1F1F text
 *     dark:  #131314 with a #8E918F hairline and #E3E3E3 text
 *   - Roboto Medium 14px where available
 *   - approved wording only ("Sign in with Google")
 *
 * The logo is inlined as SVG on purpose: the Content-Security-Policy forbids
 * off-origin requests, so a hosted image would simply not load, and inlining
 * also means the button cannot flash unbranded while an asset downloads.
 *
 * Still a plain anchor, never fetch(): the endpoint 302s to Google's consent
 * screen and a full document navigation is what sets the state cookie. Rendered
 * only when the `googleAuth` client-config flag is on (EF §2.5), so a
 * misconfigured provider never shows a button that dead-ends.
 */
export function GoogleButton({
  enabled,
  next,
  label = 'Sign in with Google',
}: {
  enabled: boolean;
  next?: string;
  /** Approved alternatives only: "Sign up with Google", "Continue with Google". */
  label?: string;
}) {
  if (!enabled) return null;

  const href = next
    ? `${GOOGLE_OAUTH_START}?next=${encodeURIComponent(next)}`
    : GOOGLE_OAUTH_START;

  return (
    <>
      <a className="bc-gsi" href={href} rel="nofollow">
        <span className="bc-gsi__icon" aria-hidden="true">
          {/* Official Google "G". Do not recolour, crop, or apply currentColor:
              the four brand colours are mandated by Google's guidelines. */}
          <svg width="18" height="18" viewBox="0 0 48 48" focusable="false">
            <path
              fill="#EA4335"
              d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
            />
            <path
              fill="#4285F4"
              d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
            />
            <path
              fill="#FBBC05"
              d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
            />
            <path
              fill="#34A853"
              d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
            />
          </svg>
        </span>
        <span className="bc-gsi__label">{label}</span>
      </a>
      <p className="bc-divider">or use your email</p>
    </>
  );
}
